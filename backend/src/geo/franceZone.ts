import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import type { Vehicle } from '../types/vehicle.js'

type ZoneGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

interface ZoneFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: ZoneGeometry
}

interface ZoneCollection {
  type: 'FeatureCollection'
  features: ZoneFeature[]
}

interface ZonePart {
  feature: ZoneFeature
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ZONE_PATH = path.resolve(__dirname, '../../data/france-zone.geojson')

let parts: ZonePart[] = []
let bounds = { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 }
let collection: ZoneCollection | null = null

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
  const raw = await readFile(ZONE_PATH, 'utf8')
  collection = JSON.parse(raw) as ZoneCollection
  parts = []
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const f of collection.features) {
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue
    const feature = f as ZoneFeature
    const bb = bboxOfFeature(feature)
    parts.push({ feature, ...bb })
    minLon = Math.min(minLon, bb.minLon)
    minLat = Math.min(minLat, bb.minLat)
    maxLon = Math.max(maxLon, bb.maxLon)
    maxLat = Math.max(maxLat, bb.maxLat)
  }
  bounds = { minLon, minLat, maxLon, maxLat }
  console.log(`[geo] France zone: ${parts.length} polygons (land + métropole EEZ)`)
}

export function getFranceZoneGeoJson(): ZoneCollection {
  if (!collection) throw new Error('France zone not loaded')
  return collection
}

export function inFranceZone(lon: number, lat: number): boolean {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
  if (parts.length === 0) return false
  if (lon < bounds.minLon || lon > bounds.maxLon || lat < bounds.minLat || lat > bounds.maxLat) return false
  const pt = point([lon, lat])
  for (const part of parts) {
    if (lon < part.minLon || lon > part.maxLon || lat < part.minLat || lat > part.maxLat) continue
    if (booleanPointInPolygon(pt, part.feature)) return true
  }
  return false
}

export function filterVehicles(vehicles: Vehicle[]): Vehicle[] {
  return vehicles.filter((v) => inFranceZone(v.lon, v.lat))
}

export function lineMidpoint(coords: [number, number][]): [number, number] | null {
  if (coords.length === 0) return null
  if (coords.length === 1) return coords[0]
  const a = coords[0]
  const b = coords[coords.length - 1]
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}
