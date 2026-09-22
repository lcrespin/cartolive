import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inFranceZone, lineMidpoint } from '../geo/franceZone.js'
import { hub } from '../hub/store.js'
import { settings } from '../config/settings.js'

export type RoadStatus = 'fluid' | 'heavy' | 'congested'

export interface RoadFeature {
  type: 'Feature'
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  properties: { status: RoadStatus; speedKmh?: number; label?: string }
}

export interface RoadCollection {
  type: 'FeatureCollection'
  features: RoadFeature[]
  updatedAt: string
  source: string
}

const POLL_MS = 6 * 60_000
const QTV_URL = settings.bisonFuteQtvUrl
const REF_URL = settings.bisonFuteRefUrl

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.resolve(__dirname, '../../.cache')
const REF_CACHE = path.join(CACHE_DIR, 'bison-fute-ref.json')

const EMPTY: RoadCollection = {
  type: 'FeatureCollection',
  features: [],
  updatedAt: new Date(0).toISOString(),
  source: 'Bison Futé QTV (DIR)',
}

interface SiteRef {
  id: string
  axis: string
  start: [number, number]
  end: [number, number]
}

let sites: SiteRef[] | null = null
let cache: RoadCollection = { ...EMPTY }

/** IGN Lambert-93 (EPSG:2154) → WGS84. */
function lambert93ToWgs84(x: number, y: number): [number, number] {
  const n = 0.725607765053267
  const c = 11_754_255.426096
  const xs = 700_000
  const ys = 12_655_612.049876
  const e = 0.0818191910428158
  const lon0 = (3 * Math.PI) / 180
  const dx = x - xs
  const dy = y - ys
  const r = Math.sqrt(dx * dx + dy * dy)
  const gamma = Math.atan2(dx, -dy)
  const lon = lon0 + gamma / n
  const latiso = -Math.log(Math.abs(r / c)) / n
  let phi = 2 * Math.atan(Math.exp(latiso)) - Math.PI / 2
  for (let i = 0; i < 7; i++) {
    const esin = e * Math.sin(phi)
    phi = 2 * Math.atan(Math.exp(latiso + (e / 2) * Math.log((1 + esin) / (1 - esin)))) - Math.PI / 2
  }
  return [(lon * 180) / Math.PI, (phi * 180) / Math.PI]
}

function statusFromSpeed(kmh: number | undefined): RoadStatus {
  if (kmh == null) return 'heavy'
  if (kmh >= 70) return 'fluid'
  if (kmh >= 40) return 'heavy'
  return 'congested'
}

function isLambertX(n: number): boolean {
  return n > 80_000 && n < 1_300_000
}

function isLambertY(n: number): boolean {
  return n > 6_000_000 && n < 7_300_000
}

function inFrance(lon: number, lat: number): boolean {
  return lon > -6 && lon < 10 && lat > 41 && lat < 52
}

function sitesLookValid(list: SiteRef[]): boolean {
  if (!list.length) return false
  const sample = list.slice(0, 30)
  const ok = sample.filter((s) => inFrance(s.start[0], s.start[1])).length
  return ok >= Math.ceil(sample.length * 0.5)
}

/** Rows often omit `code_insee_commune`, so named indexes shift. Find Lambert X/Y quads instead. */
function lambertQuad(cols: string[]): [number, number, number, number] | null {
  for (let i = 0; i + 3 < cols.length; i++) {
    const xd = Number(cols[i])
    const yd = Number(cols[i + 1])
    const xf = Number(cols[i + 2])
    const yf = Number(cols[i + 3])
    if (isLambertX(xd) && isLambertY(yd) && isLambertX(xf) && isLambertY(yf)) {
      return [xd, yd, xf, yf]
    }
  }
  return null
}

function parseRefCsv(text: string): SiteRef[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const header = lines[0]?.split(';').map((h) => h.trim().toLowerCase()) ?? []
  const iId = header.indexOf('code_pme')
  const out: SiteRef[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';')
    const id = (iId >= 0 ? cols[iId] : cols[0])?.trim()
    const xy = lambertQuad(cols)
    if (!id || !xy) continue
    const axis =
      cols.find((c) => /^(A|N|D|M|RN|RD)\d/i.test(c.trim())) ?? id
    out.push({
      id,
      axis,
      start: lambert93ToWgs84(xy[0], xy[1]),
      end: lambert93ToWgs84(xy[2], xy[3]),
    })
  }
  return out
}

function decodeRefBuffer(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8')
  const asUtf8 = buf.toString('utf8')
  if (asUtf8.includes('code_pme') || asUtf8.includes('x_deb')) return asUtf8
  return buf.toString('latin1')
}

async function loadSites(): Promise<SiteRef[]> {
  if (sites && sitesLookValid(sites)) return sites
  try {
    const raw = await readFile(REF_CACHE, 'utf8')
    const cached = JSON.parse(raw) as SiteRef[]
    if (sitesLookValid(cached)) {
      sites = cached
      return sites
    }
  } catch {
    // download
  }
  const res = await fetch(REF_URL, {
    headers: { 'User-Agent': 'breathe.live', Accept: 'text/csv,*/*' },
  })
  if (!res.ok) throw new Error(`Bison Futé ref ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  sites = parseRefCsv(decodeRefBuffer(buf))
  if (!sitesLookValid(sites)) throw new Error('Bison Futé ref: no usable Lambert geometry')
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(REF_CACHE, JSON.stringify(sites))
  console.log(`[bison-fute] cached ${sites.length} counting stations`)
  return sites
}

function parseQtvSpeeds(xml: string): Map<string, number> {
  const speeds = new Map<string, number>()
  const blocks = xml.split(/<siteMeasurements>/i).slice(1)
  for (const block of blocks) {
    const id = block.match(/measurementSiteReference[^>]*\sid="([^"]+)"/i)?.[1]
    const speed = Number(block.match(/<speed>([^<]+)<\/speed>/i)?.[1])
    if (id && Number.isFinite(speed)) speeds.set(id, speed)
  }
  return speeds
}

function filterRoadFeatures(features: RoadFeature[]): RoadFeature[] {
  return features.filter((f) => {
    const mid = lineMidpoint(f.geometry.coordinates)
    return mid != null && inFranceZone(mid[0], mid[1])
  })
}

async function poll(): Promise<void> {
  try {
    const refs = await loadSites()
    const res = await fetch(QTV_URL, {
      headers: { 'User-Agent': 'breathe.live', Accept: 'application/xml,text/xml,*/*' },
    })
    if (!res.ok) throw new Error(`QTV ${res.status}`)
    const xml = await res.text()
    const speeds = parseQtvSpeeds(xml)
    const byId = new Map(refs.map((s) => [s.id, s]))
    const features: RoadFeature[] = []
    for (const [id, speed] of speeds) {
      const site = byId.get(id)
      if (!site) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [site.start, site.end] },
        properties: {
          status: statusFromSpeed(speed),
          speedKmh: speed,
          label: site.axis,
        },
      })
    }
    const filtered = filterRoadFeatures(features)
    cache = {
      type: 'FeatureCollection',
      features: filtered,
      updatedAt: new Date().toISOString(),
      source: 'Bison Futé QTV / DIR (Tipi open data)',
    }
    hub.setFeedHealth('bison_fute', {
      ok: true,
      lastSuccessAt: cache.updatedAt,
      lastError: filtered.length === 0 ? '0 segments joined' : null,
      vehicleCount: filtered.length,
    })
    console.log(`[bison-fute] ${filtered.length} segments`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    hub.setFeedHealth('bison_fute', {
      ok: false,
      lastError: msg,
      vehicleCount: cache.features.length,
    })
    console.warn('[bison-fute]', msg)
  }
}

export function getRoadTraffic(): RoadCollection {
  return cache
}

export function getRoadSnapshot(): Pick<RoadCollection, 'features' | 'updatedAt' | 'source'> {
  return {
    features: cache.features,
    updatedAt: cache.updatedAt,
    source: cache.source,
  }
}

export function startBisonFute(): void {
  hub.setFeedHealth('bison_fute', {
    ok: false,
    lastError: 'starting',
    vehicleCount: 0,
  })
  console.log('[bison-fute] QTV + counting-station referential (~6 min)')
  void poll()
  setInterval(() => void poll(), POLL_MS)
}
