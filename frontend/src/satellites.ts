import * as satellite from 'satellite.js'
import type { Satellite, SatelliteGroup, TleRecord } from './types'

interface CachedSatrec {
  id: string
  name: string
  group: SatelliteGroup
  satrec: satellite.SatRec
}

export function buildSatrecs(group: SatelliteGroup, records: TleRecord[]): CachedSatrec[] {
  const out: CachedSatrec[] = []
  for (const rec of records) {
    try {
      const satrec = satellite.twoline2satrec(rec.line1, rec.line2)
      if (satrec.error) continue
      out.push({
        id: `${group}:${rec.line1.slice(2, 7).trim()}:${rec.name}`,
        name: rec.name,
        group,
        satrec,
      })
    } catch {
      // skip bad TLE
    }
  }
  return out
}

function propagateOne(
  item: CachedSatrec,
  gmst: number,
  at: Date,
  keep?: (lon: number, lat: number) => boolean,
): Satellite | null {
  const pv = satellite.propagate(item.satrec, at)
  const position = pv?.position
  if (!position || typeof position === 'boolean') return null
  const geo = satellite.eciToGeodetic(position, gmst)
  const lat = satellite.degreesLat(geo.latitude)
  const lon = satellite.degreesLong(geo.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (keep && !keep(lon, lat)) return null
  return {
    id: item.id,
    name: item.name,
    group: item.group,
    lon,
    lat,
    altitudeKm: geo.height,
  }
}

export function propagateAll(
  items: CachedSatrec[],
  at = new Date(),
  keep?: (lon: number, lat: number) => boolean,
): Satellite[] {
  const gmst = satellite.gstime(at)
  const out: Satellite[] = []
  for (const item of items) {
    const s = propagateOne(item, gmst, at, keep)
    if (s) out.push(s)
  }
  return out
}

export async function propagateAllAsync(
  items: CachedSatrec[],
  options?: {
    at?: Date
    keep?: (lon: number, lat: number) => boolean
    chunk?: number
  },
): Promise<Satellite[]> {
  const at = options?.at ?? new Date()
  const chunk = options?.chunk ?? 400
  const keep = options?.keep
  const gmst = satellite.gstime(at)
  const out: Satellite[] = []
  for (let i = 0; i < items.length; i++) {
    const s = propagateOne(items[i], gmst, at, keep)
    if (s) out.push(s)
    if (i > 0 && i % chunk === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  return out
}

export type { CachedSatrec }
