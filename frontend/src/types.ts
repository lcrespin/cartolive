export type VehicleType = 'plane' | 'train' | 'boat' | 'bus' | 'metro'

export interface VehicleMotionLeg {
  fromLon: number
  fromLat: number
  toLon: number
  toLat: number
  startAt: string
  endAt: string
  toLabel?: string
}

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
  altitudeM?: number
  motion?: VehicleMotionLeg
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
  bus: 'Buses',
  metro: 'Metro',
}

export { LAYER_COLORS, SATELLITE_COLOR, VEHICLE_COLORS } from './colors'

/** Bottom → top paint order on the map */
export const LAYER_STACK_ORDER: VehicleType[] = ['boat', 'metro', 'bus', 'train', 'plane']

/** Layer panel order (top to bottom in UI) */
export const UI_LAYER_TYPES: VehicleType[] = ['plane', 'train', 'bus', 'metro', 'boat']

export const ALL_TYPES: VehicleType[] = UI_LAYER_TYPES

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
    properties: { status: RoadStatus; speedKmh?: number; label?: string; statusDetail?: string }
  }>
  updatedAt: string
  source: string
}
