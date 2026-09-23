import type { VehicleMotionLeg } from './motion.js'

export type VehicleType = 'plane' | 'train' | 'boat' | 'bus' | 'metro'

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
  /** Barometric or geometric altitude (m), mainly planes */
  altitudeM?: number
  /** Interpolate between stops when GTFS-RT has no live GPS */
  motion?: VehicleMotionLeg
  updatedAt: string
}

export type { VehicleMotionLeg } from './motion.js'

export interface Co2Factors {
  plane: number
  train: number
  boat: number
  bus: number
  source: string
  updatedAt: string
}

export interface FeedHealth {
  name: string
  ok: boolean
  lastSuccessAt: string | null
  lastError: string | null
  vehicleCount: number
}
