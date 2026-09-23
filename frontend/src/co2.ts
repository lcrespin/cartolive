import type { Co2Factors, Vehicle, VehicleType } from './types'

function co2FactorGPerKm(type: VehicleType, factors: Co2Factors): number {
  if (type === 'metro') return factors.bus
  return factors[type]
}

export function co2PerHourKg(v: Vehicle, factors: Co2Factors): number {
  const factor = co2FactorGPerKm(v.type, factors)
  const passengers = v.passengers ?? defaultPassengers(v.type)
  const kmh = v.speedKmh ?? defaultSpeed(v.type)
  return (factor * kmh * passengers) / 1000
}

export function co2TripPerPassengerKg(v: Vehicle, factors: Co2Factors): number | null {
  if (v.distanceKm == null) return null
  return (co2FactorGPerKm(v.type, factors) * v.distanceKm) / 1000
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
    case 'metro':
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
    case 'metro':
      return 25
  }
}

/** 0–1 visual weight for the live viewport CO₂ panel (log-scaled kg CO₂e/h). */
export function co2ViewportIntensity(kgPerHour: number): number {
  if (!Number.isFinite(kgPerHour) || kgPerHour <= 0) return 0
  const x = Math.log10(kgPerHour + 1)
  return Math.min(1, Math.max(0, (x - 0.4) / 4.4))
}
