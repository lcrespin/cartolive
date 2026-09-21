import type { Co2Factors, Vehicle, VehicleType } from './types'

export function co2PerHourKg(v: Vehicle, factors: Co2Factors): number {
  const factor = factors[v.type]
  const passengers = v.passengers ?? defaultPassengers(v.type)
  const kmh = v.speedKmh ?? defaultSpeed(v.type)
  return (factor * kmh * passengers) / 1000
}

export function co2TripPerPassengerKg(v: Vehicle, factors: Co2Factors): number | null {
  if (v.distanceKm == null) return null
  return (factors[v.type] * v.distanceKm) / 1000
}

function defaultPassengers(type: VehicleType): number {
  switch (type) {
    case 'plane':
      return 150
    case 'train':
      return 300
    case 'boat':
      return 400
    case 'bus':
      return 30
  }
}

function defaultSpeed(type: VehicleType): number {
  switch (type) {
    case 'plane':
      return 800
    case 'train':
      return 200
    case 'boat':
      return 30
    case 'bus':
      return 25
  }
}
