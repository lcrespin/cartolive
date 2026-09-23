import type { Vehicle, VehicleType } from '../types/vehicle.js'

export type RouteIndex = Record<string, { shortName: string; mode?: string }>

export function idfmTransitType(routeId: string | undefined, routes: RouteIndex): VehicleType {
  const mode = routeId ? routes[routeId]?.mode : undefined
  if (mode && /\bmetro\b/i.test(mode)) return 'metro'
  return 'bus'
}

export function splitIdfmVehicles(vehicles: Vehicle[], routes: RouteIndex): { metro: Vehicle[]; bus: Vehicle[] } {
  const metro: Vehicle[] = []
  const bus: Vehicle[] = []
  for (const v of vehicles) {
    const routeId = v.to
    const type = idfmTransitType(routeId, routes)
    if (type === 'metro') metro.push({ ...v, type: 'metro' })
    else bus.push({ ...v, type: 'bus' })
  }
  return { metro, bus }
}

export function idfmVehicleCount(metro: Vehicle[], bus: Vehicle[]): number {
  return metro.length + bus.length
}
