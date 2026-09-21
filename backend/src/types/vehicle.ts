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

export interface FeedHealth {
  name: string
  ok: boolean
  lastSuccessAt: string | null
  lastError: string | null
  vehicleCount: number
}
