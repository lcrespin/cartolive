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

export function propagateAll(items: CachedSatrec[], at = new Date()): Satellite[] {
  const gmst = satellite.gstime(at)
  const out: Satellite[] = []
  for (const item of items) {
    const pv = satellite.propagate(item.satrec, at)
    if (!pv?.position) continue
    const geo = satellite.eciToGeodetic(pv.position, gmst)
    const lat = satellite.degreesLat(geo.latitude)
    const lon = satellite.degreesLong(geo.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    out.push({
      id: item.id,
      name: item.name,
      group: item.group,
      lon,
      lat,
      altitudeKm: geo.height,
    })
  }
  return out
}

export type { CachedSatrec }
