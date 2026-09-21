import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hub } from '../hub/store.js'
import { fetchGtfsRtBuffer, parseTripUpdates, parseVehiclePositions } from './gtfsRt.js'
import type { Vehicle } from '../types/vehicle.js'

const POLL_MS = 30_000

/** Optional true VehiclePositions feed (preferred when set). */
const VP_URL = process.env.IDFM_GTFS_RT_URL

/**
 * IDFM has no public official VehiclePositions GTFS-RT.
 * Community converter (SIRI Lite → GTFS-RT trip updates):
 * https://github.com/Jouca/IDFM_GTFS-RT
 */
const TRIP_UPDATES_URL =
  process.env.IDFM_TRIP_UPDATES_URL ?? 'http://gtfsidfm.clarifygdps.com/gtfs-rt-trips-idfm'

const STOPS_EXPORT_URL =
  process.env.IDFM_STOPS_URL ??
  'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/exports/csv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.resolve(__dirname, '../../.cache')
const STOPS_CACHE = path.join(CACHE_DIR, 'idfm-stops.json')
const ROUTES_CACHE = path.join(CACHE_DIR, 'idfm-routes.json')

type StopIndex = Record<string, { lat: number; lon: number; name: string }>
type RouteIndex = Record<string, { shortName: string; mode?: string }>

async function ensureIndexes(): Promise<{ stops: StopIndex; routes: RouteIndex }> {
  try {
    await access(STOPS_CACHE)
    await access(ROUTES_CACHE)
    const stops = JSON.parse(await readFile(STOPS_CACHE, 'utf8')) as StopIndex
    const routes = JSON.parse(await readFile(ROUTES_CACHE, 'utf8')) as RouteIndex
    return { stops, routes }
  } catch {
    // download below
  }

  console.log('[idfm] downloading stop/route index (arrets-lignes)…')
  await mkdir(CACHE_DIR, { recursive: true })
  const res = await fetch(STOPS_EXPORT_URL, {
    headers: { Accept: 'text/csv', 'User-Agent': 'breathe.live', 'Accept-Encoding': 'identity' },
  })
  if (!res.ok) throw new Error(`IDFM stops export ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // Portal sometimes returns gzip with Content-Type: text/csv (no Content-Encoding)
  const text =
    buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
      ? (await import('node:zlib')).gunzipSync(buf).toString('utf8')
      : buf.toString('utf8')
  const { stops, routes } = parseArretsCsv(text)
  await writeFile(STOPS_CACHE, JSON.stringify(stops))
  await writeFile(ROUTES_CACHE, JSON.stringify(routes))
  console.log(`[idfm] cached ${Object.keys(stops).length} stops, ${Object.keys(routes).length} routes`)
  return { stops, routes }
}

function parseArretsCsv(text: string): { stops: StopIndex; routes: RouteIndex } {
  const cleaned = text.replace(/^\uFEFF/, '')
  const lines = cleaned.split(/\r?\n/)
  const delimiter = (lines[0] ?? '').includes(';') ? ';' : ','
  const header = splitCsv(lines[0] ?? '', delimiter).map((h) => h.replace(/"/g, '').trim().toLowerCase())
  const iStopId = header.indexOf('stop_id')
  const iName = header.indexOf('stop_name')
  const iLat = header.indexOf('stop_lat')
  const iLon = header.indexOf('stop_lon')
  const iRoute = header.indexOf('id')
  const iShort = header.indexOf('shortname')
  const iMode = header.indexOf('mode')

  const stops: StopIndex = {}
  const routes: RouteIndex = {}

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const cols = splitCsv(line, delimiter)
    const stopId = cols[iStopId]?.replace(/"/g, '')
    const lat = Number(cols[iLat])
    const lon = Number(cols[iLon])
    if (stopId && Number.isFinite(lat) && Number.isFinite(lon)) {
      stops[stopId] = {
        lat,
        lon,
        name: (cols[iName] ?? stopId).replace(/"/g, ''),
      }
    }
    const routeId = cols[iRoute]?.replace(/"/g, '')
    const shortName = cols[iShort]?.replace(/"/g, '')
    if (routeId && shortName && !routes[routeId]) {
      routes[routeId] = {
        shortName,
        mode: cols[iMode]?.replace(/"/g, '') || undefined,
      }
    }
  }
  return { stops, routes }
}

function splitCsv(line: string, delimiter = ','): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (c === delimiter && !inQuotes) {
      result.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  result.push(cur)
  return result
}

function busLabel(routeId: string | undefined, fallback: string, routes: RouteIndex): string {
  if (routeId && routes[routeId]?.shortName) {
    const mode = routes[routeId].mode
    const name = routes[routeId].shortName
    if (mode && /metro|rer|tram|rail/i.test(mode)) return `${mode} ${name}`
    return `Line ${name}`
  }
  return fallback.length > 40 ? `${fallback.slice(0, 37)}…` : fallback
}

async function pollVp(): Promise<void> {
  if (!VP_URL) return
  const buffer = await fetchGtfsRtBuffer(VP_URL)
  const vehicles = parseVehiclePositions(buffer, 'bus', 'idfm-')
  hub.replaceType('bus', vehicles)
  hub.setFeedHealth('idfm', {
    ok: true,
    lastSuccessAt: new Date().toISOString(),
    lastError: null,
    vehicleCount: vehicles.length,
  })
}

async function pollTripUpdates(stops: StopIndex, routes: RouteIndex): Promise<void> {
  const buffer = await fetchGtfsRtBuffer(TRIP_UPDATES_URL)
  const updates = parseTripUpdates(buffer)
  const now = new Date().toISOString()
  const vehicles: Vehicle[] = []
  const seen = new Set<string>()

  for (const u of updates) {
    if (!u.stopId) continue
    const stop = stops[u.stopId]
    if (!stop) continue
    const id = u.id
    if (seen.has(id)) continue
    seen.add(id)
    vehicles.push({
      id,
      type: 'bus',
      label: busLabel(u.routeId, u.label, routes),
      lon: stop.lon,
      lat: stop.lat,
      to: stop.name,
      updatedAt: now,
    })
  }

  hub.replaceType('bus', vehicles)
  hub.setFeedHealth('idfm', {
    ok: true,
    lastSuccessAt: new Date().toISOString(),
    lastError: null,
    vehicleCount: vehicles.length,
  })
}

export async function startIdfm(): Promise<void> {
  if (VP_URL) {
    console.log('[idfm] starting GTFS-RT vehicle positions')
    const run = async () => {
      try {
        await pollVp()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[idfm]', msg)
        hub.setFeedHealth('idfm', { ok: false, lastError: msg, vehicleCount: hub.countByType('bus') })
      }
    }
    void run()
    setInterval(() => void run(), POLL_MS)
    return
  }

  console.log('[idfm] starting trip-updates → stop coordinates (approximate; no public VP feed)')
  try {
    const { stops, routes } = await ensureIndexes()
    const run = async () => {
      try {
        await pollTripUpdates(stops, routes)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[idfm]', msg)
        hub.setFeedHealth('idfm', { ok: false, lastError: msg, vehicleCount: hub.countByType('bus') })
      }
    }
    void run()
    setInterval(() => void run(), POLL_MS)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[idfm] failed to load stops', msg)
    hub.setFeedHealth('idfm', { ok: false, lastError: msg, vehicleCount: 0 })
  }
}
