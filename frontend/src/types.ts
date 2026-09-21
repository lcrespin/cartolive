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
