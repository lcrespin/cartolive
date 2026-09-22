import { hub } from '../hub/store.js'
import { fetchGtfsRtBuffer, parseTripUpdates, parseVehiclePositions } from './gtfsRt.js'
import type { Vehicle } from '../types/vehicle.js'
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { settings } from '../config/settings.js'

const execFileAsync = promisify(execFile)
const POLL_MS = 30_000
const DEFAULT_SNCF_TU = settings.sncfGtfsRtUrl
const DEFAULT_SNCF_GTFS = settings.sncfGtfsStaticUrl

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.resolve(__dirname, '../../.cache')
const STOPS_CACHE = path.join(CACHE_DIR, 'sncf-stops.json')

type StopIndex = Record<string, { lat: number; lon: number; name: string }>

async function ensureStops(): Promise<StopIndex> {
  try {
    await access(STOPS_CACHE)
    return JSON.parse(await readFile(STOPS_CACHE, 'utf8')) as StopIndex
  } catch {
    // download below
  }

  console.log('[sncf] downloading static GTFS for stop coordinates…')
  await mkdir(CACHE_DIR, { recursive: true })
  const zipPath = path.join(CACHE_DIR, 'sncf-gtfs.zip')
  const res = await fetch(DEFAULT_SNCF_GTFS)
  if (!res.ok) throw new Error(`SNCF GTFS static ${res.status}`)
  await writeFile(zipPath, Buffer.from(await res.arrayBuffer()))

  const extractDir = path.join(CACHE_DIR, 'sncf-gtfs')
  await mkdir(extractDir, { recursive: true })
  try {
    await execFileAsync('unzip', ['-o', zipPath, 'stops.txt', '-d', extractDir])
  } catch {
    await execFileAsync('unzip', ['-o', zipPath, '-d', extractDir])
  }

  const stopsPath = await findFile(extractDir, 'stops.txt')
  if (!stopsPath) throw new Error('stops.txt not found in SNCF GTFS')
  const index = parseStopsCsv(await readFile(stopsPath, 'utf8'))
  await writeFile(STOPS_CACHE, JSON.stringify(index))
  console.log(`[sncf] cached ${Object.keys(index).length} stops`)
  return index
}

async function findFile(dir: string, name: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isFile() && e.name === name) return full
    if (e.isDirectory()) {
      const nested = await findFile(full, name)
      if (nested) return nested
    }
  }
  return null
}

function parseStopsCsv(text: string): StopIndex {
  const lines = text.split(/\r?\n/)
  const header = (lines[0] ?? '').split(',').map((h) => h.replace(/"/g, '').trim())
  const iId = header.indexOf('stop_id')
  const iName = header.indexOf('stop_name')
  const iLat = header.indexOf('stop_lat')
  const iLon = header.indexOf('stop_lon')
  const out: StopIndex = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const cols = splitCsv(line)
    const id = cols[iId]
    const lat = Number(cols[iLat])
    const lon = Number(cols[iLon])
    if (!id || Number.isNaN(lat) || Number.isNaN(lon)) continue
    out[id] = { lat, lon, name: cols[iName] ?? id }
  }
  return out
}

function splitCsv(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (c === ',' && !inQuotes) {
      result.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  result.push(cur)
  return result
}

async function poll(stops: StopIndex): Promise<void> {
  try {
    const buffer = await fetchGtfsRtBuffer(DEFAULT_SNCF_TU)
    const asVp = parseVehiclePositions(buffer, 'train', 'sncf-')
    let vehicles: Vehicle[]
    if (asVp.length > 0) {
      vehicles = asVp
    } else {
      const updates = parseTripUpdates(buffer)
      const now = new Date().toISOString()
      vehicles = []
      for (const u of updates) {
        if (!u.stopId) continue
        const stop = stops[u.stopId]
        if (!stop) continue
        vehicles.push({
          id: u.id,
          type: 'train',
          label: u.label,
          lon: stop.lon,
          lat: stop.lat,
          to: stop.name,
          updatedAt: now,
        })
      }
    }
    hub.replaceType('train', vehicles)
    hub.setFeedHealth('sncf', {
      ok: true,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      vehicleCount: vehicles.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sncf]', msg)
    hub.setFeedHealth('sncf', { ok: false, lastError: msg, vehicleCount: hub.countByType('train') })
  }
}

export async function startSncf(): Promise<void> {
  console.log('[sncf] starting (trip-updates → stop coordinates; approximate positions)')
  try {
    const stops = await ensureStops()
    const run = () => void poll(stops)
    run()
    setInterval(run, POLL_MS)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sncf] failed to load stops', msg)
    hub.setFeedHealth('sncf', { ok: false, lastError: msg, vehicleCount: 0 })
  }
}
