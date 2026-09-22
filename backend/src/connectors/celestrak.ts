import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hub } from '../hub/store.js'

export const SATELLITE_GROUPS = ['stations', 'starlink', 'gps-ops', 'weather'] as const
export type SatelliteGroup = (typeof SATELLITE_GROUPS)[number]

export interface TleRecord {
  name: string
  line1: string
  line2: string
}

const GP_URL = 'https://celestrak.org/NORAD/elements/gp.php'
const SUP_URL = 'https://celestrak.org/NORAD/elements/supplemental/sup-gp.php'
const CACHE_TTL_MS = 2 * 60 * 60_000
const REFRESH_MS = 2 * 60 * 60_000
const FETCH_HEADERS = {
  'User-Agent': 'breathe.live (personal, cached 2h)',
  Accept: 'text/plain',
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.resolve(__dirname, '../../.cache')

const memory = new Map<SatelliteGroup, { records: TleRecord[]; fetchedAt: number }>()
let downloadChain: Promise<void> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = downloadChain.then(fn, fn)
  downloadChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function isSatelliteGroup(value: string): value is SatelliteGroup {
  return (SATELLITE_GROUPS as readonly string[]).includes(value)
}

function parseTle(text: string): TleRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const out: TleRecord[] = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]
    if (!line1?.startsWith('1 ') || !line2?.startsWith('2 ')) continue
    out.push({ name, line1, line2 })
  }
  return out
}

function keepWeather(name: string): boolean {
  const n = name.toUpperCase()
  if (/\b(DEB|R\/B|AKM|DEBRIS)\b/.test(n)) return false
  return /^(NOAA|GOES|METOP|FENGYUN|FY-|METEOSAT|HIMAWARI|DMSP|METEOR|ELEKTRO|EWS-G)\b/.test(
    n.trim(),
  )
}

function satKey(rec: TleRecord): string {
  return rec.line1.slice(2, 8).trim()
}

function mergeRecords(chunks: TleRecord[][]): TleRecord[] {
  const byId = new Map<string, TleRecord>()
  for (const chunk of chunks) {
    for (const rec of chunk) byId.set(satKey(rec), rec)
  }
  return [...byId.values()]
}

async function readDisk(group: SatelliteGroup): Promise<{ records: TleRecord[]; fetchedAt: number } | null> {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `tle-${group}.json`), 'utf8')
    const parsed = JSON.parse(raw) as { records: TleRecord[]; fetchedAt: number }
    if (parsed.records?.length) return parsed
  } catch {
    // no cache
  }
  return null
}

async function writeDisk(group: SatelliteGroup, records: TleRecord[], fetchedAt: number): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(path.join(CACHE_DIR, `tle-${group}.json`), JSON.stringify({ records, fetchedAt }))
}

async function fetchTleText(url: string): Promise<string> {
  const res = await fetch(url, { headers: FETCH_HEADERS })
  const text = await res.text()
  if (!res.ok) throw new Error(`CelesTrak ${res.status} ${url}`)
  const head = text.slice(0, 240)
  if (head.startsWith('<!DOCTYPE') || head.startsWith('<html') || head.startsWith('<HTML')) {
    throw new Error(`CelesTrak HTML instead of TLE (${url})`)
  }
  if (head.startsWith('Invalid query') || /use cache|403 Forbidden|Access Denied/i.test(head)) {
    throw new Error(`CelesTrak rejected ${url}`)
  }
  return text
}

async function downloadSources(urls: string[], filter?: (name: string) => boolean): Promise<TleRecord[]> {
  const chunks: TleRecord[][] = []
  const errors: string[] = []
  for (const url of urls) {
    try {
      const records = parseTle(await fetchTleText(url))
      chunks.push(filter ? records.filter((r) => filter(r.name)) : records)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  const merged = mergeRecords(chunks)
  if (merged.length === 0) {
    throw new Error(errors[0] ?? 'CelesTrak empty TLE')
  }
  return merged
}

function sourcesFor(group: SatelliteGroup): { urls: string[]; filter?: (name: string) => boolean } {
  switch (group) {
    case 'stations':
      return { urls: [`${GP_URL}?GROUP=stations&FORMAT=TLE`] }
    case 'starlink':
      return {
        urls: [
          `${SUP_URL}?FILE=starlink&FORMAT=tle`,
          `${GP_URL}?GROUP=starlink&FORMAT=TLE`,
        ],
      }
    case 'gps-ops':
      return {
        urls: [`${SUP_URL}?FILE=gps&FORMAT=tle`, `${GP_URL}?GROUP=gps-ops&FORMAT=TLE`],
      }
    case 'weather':
      return {
        urls: [
          `${GP_URL}?NAME=NOAA&FORMAT=TLE`,
          `${GP_URL}?NAME=GOES&FORMAT=TLE`,
          `${GP_URL}?NAME=METOP&FORMAT=TLE`,
          `${SUP_URL}?FILE=eumetsat&FORMAT=tle`,
          `${GP_URL}?GROUP=weather&FORMAT=TLE`,
        ],
        filter: keepWeather,
      }
  }
}

function setHealth(): void {
  const groups = [...memory.values()]
  const ok = groups.some((g) => g.records.length > 0)
  const last = groups.reduce((max, g) => Math.max(max, g.fetchedAt), 0)
  hub.setFeedHealth('celestrak', {
    ok,
    lastSuccessAt: last ? new Date(last).toISOString() : null,
    lastError: ok ? null : 'no TLE groups cached',
    vehicleCount: groups.reduce((n, g) => n + g.records.length, 0),
  })
}

export async function getTleGroup(group: SatelliteGroup): Promise<TleRecord[]> {
  const mem = memory.get(group)
  if (mem && Date.now() - mem.fetchedAt < CACHE_TTL_MS) return mem.records

  const disk = await readDisk(group)
  if (disk && Date.now() - disk.fetchedAt < CACHE_TTL_MS) {
    memory.set(group, disk)
    setHealth()
    return disk.records
  }

  try {
    const { urls, filter } = sourcesFor(group)
    const records = await enqueue(() => downloadSources(urls, filter))
    const fetchedAt = Date.now()
    memory.set(group, { records, fetchedAt })
    await writeDisk(group, records, fetchedAt)
    setHealth()
    return records
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (disk) {
      memory.set(group, disk)
      hub.setFeedHealth('celestrak', {
        ok: true,
        lastSuccessAt: new Date(disk.fetchedAt).toISOString(),
        lastError: `refresh failed, serving cache: ${msg}`,
        vehicleCount: [...memory.values()].reduce((n, g) => n + g.records.length, 0),
      })
      return disk.records
    }
    setHealth()
    throw err
  }
}

export function getCelestrakSnapshot(): {
  tleObjects: number
  groups: Record<SatelliteGroup, { count: number; cachedAt: string | null }>
} {
  const groups = {} as Record<SatelliteGroup, { count: number; cachedAt: string | null }>
  let tleObjects = 0
  for (const group of SATELLITE_GROUPS) {
    const mem = memory.get(group)
    const count = mem?.records.length ?? 0
    tleObjects += count
    groups[group] = {
      count,
      cachedAt: mem ? new Date(mem.fetchedAt).toISOString() : null,
    }
  }
  return { tleObjects, groups }
}

export async function startCelestrak(): Promise<void> {
  hub.setFeedHealth('celestrak', {
    ok: false,
    lastError: 'starting',
    vehicleCount: 0,
  })
  console.log('[celestrak] warming TLE groups (stations disk / others supplemental)')
  for (const group of SATELLITE_GROUPS) {
    try {
      const records = await getTleGroup(group)
      console.log(`[celestrak] ${group}: ${records.length} objects`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[celestrak] ${group} failed:`, msg)
    }
  }
  setInterval(() => {
    void (async () => {
      for (const group of SATELLITE_GROUPS) {
        memory.delete(group)
        try {
          await getTleGroup(group)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`[celestrak] refresh ${group}:`, msg)
        }
      }
    })()
  }, REFRESH_MS)
}
