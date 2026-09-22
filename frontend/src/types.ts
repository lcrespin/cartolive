export type VehicleType = 'plane' | 'train' | 'boat' | 'bus'

export interface Vehicle {
  id: string
  type: VehicleType
  label: string
  lon: number
  lat: number
  heading?: number
  from?: string
  to?: string
  distanceKm?: number
  speedKmh?: number
  passengers?: number
  updatedAt: string
}

export interface Co2Factors {
  plane: number
  train: number
  boat: number
  bus: number
  source: string
  updatedAt: string
}

export const TYPE_LABEL: Record<VehicleType, string> = {
  plane: 'Plane',
  train: 'Train',
  boat: 'Boat',
  bus: 'Bus / metro',
}

export const LAYER_COLORS: Record<VehicleType, string> = {
  plane: '#3ed9c4',
  train: '#6fb8f0',
  boat: '#c792ea',
  bus: '#f2a65a',
}

export const ALL_TYPES: VehicleType[] = ['plane', 'train', 'boat', 'bus']

export const SATELLITE_GROUPS = ['stations', 'starlink', 'gps-ops', 'weather'] as const
export type SatelliteGroup = (typeof SATELLITE_GROUPS)[number]

export const SAT_GROUP_LABEL: Record<SatelliteGroup, string> = {
  stations: 'Stations',
  starlink: 'Starlink',
  'gps-ops': 'GPS',
  weather: 'Weather',
}

export interface TleRecord {
  name: string
  line1: string
  line2: string
}

export interface Satellite {
  id: string
  name: string
  group: SatelliteGroup
  lon: number
  lat: number
  altitudeKm: number
}

export type RoadStatus = 'fluid' | 'heavy' | 'congested'

export interface RoadCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'LineString'; coordinates: [number, number][] }
    properties: { status: RoadStatus; speedKmh?: number; label?: string }
  }>
  updatedAt: string
  source: string
}
