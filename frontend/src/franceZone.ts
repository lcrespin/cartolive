import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'

type ZoneGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

interface ZoneFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: ZoneGeometry
}

interface ZonePart {
  feature: ZoneFeature
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

let parts: ZonePart[] = []
let bounds = { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 }
let ready = false

function walkBbox(coords: unknown, acc: number[][]): void {
  if (!Array.isArray(coords)) return
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    acc.push(coords as number[])
    return
  }
  for (const c of coords) walkBbox(c, acc)
}

function bboxOfFeature(f: ZoneFeature): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  const pts: number[][] = []
  walkBbox(f.geometry.coordinates, pts)
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon
    if (lat < minLat) minLat = lat
    if (lon > maxLon) maxLon = lon
    if (lat > maxLat) maxLat = lat
  }
  return { minLon, minLat, maxLon, maxLat }
}

export async function initFranceZone(): Promise<void> {
  const res = await fetch('/api/geo/france-zone')
  if (!res.ok) throw new Error(`France zone ${res.status}`)
  const collection = (await res.json()) as { features: ZoneFeature[] }
  parts = []
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const f of collection.features) {
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue
    const bb = bboxOfFeature(f)
    parts.push({ feature: f, ...bb })
    minLon = Math.min(minLon, bb.minLon)
    minLat = Math.min(minLat, bb.minLat)
    maxLon = Math.max(maxLon, bb.maxLon)
    maxLat = Math.max(maxLat, bb.maxLat)
  }
  bounds = { minLon, minLat, maxLon, maxLat }
  ready = true
}

export function franceZoneReady(): boolean {
  return ready
}

export function inFranceZone(lon: number, lat: number): boolean {
  if (!ready || parts.length === 0) return false
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
  if (lon < bounds.minLon || lon > bounds.maxLon || lat < bounds.minLat || lat > bounds.maxLat) return false
  const pt = point([lon, lat])
  for (const part of parts) {
    if (lon < part.minLon || lon > part.maxLon || lat < part.minLat || lat > part.maxLat) continue
    if (booleanPointInPolygon(pt, part.feature as Parameters<typeof booleanPointInPolygon>[1])) return true
  }
  return false
}
