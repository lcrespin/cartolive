import type { Vehicle, VehicleMotionLeg } from './types'

export function bearingDeg(fromLon: number, fromLat: number, toLon: number, toLat: number): number {
  const φ1 = (fromLat * Math.PI) / 180
  const φ2 = (toLat * Math.PI) / 180
  const Δλ = ((toLon - fromLon) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function alongLeg(motion: VehicleMotionLeg, nowMs: number): { lon: number; lat: number } {
  const startMs = new Date(motion.startAt).getTime()
  const endMs = new Date(motion.endAt).getTime()
  const span = endMs - startMs
  const t = span > 0 ? Math.min(1, Math.max(0, (nowMs - startMs) / span)) : 0
  return {
    lon: motion.fromLon + t * (motion.toLon - motion.fromLon),
    lat: motion.fromLat + t * (motion.toLat - motion.fromLat),
  }
}

export function trainDisplayState(
  v: Vehicle,
  nowMs: number,
): { lon: number; lat: number; heading: number } {
  if (v.motion) {
    const { lon, lat } = alongLeg(v.motion, nowMs)
    const heading = bearingDeg(v.motion.fromLon, v.motion.fromLat, v.motion.toLon, v.motion.toLat)
    return { lon, lat, heading }
  }
  return { lon: v.lon, lat: v.lat, heading: v.heading ?? 0 }
}

export function trainsNeedMotionAnimation(vehicles: Vehicle[]): boolean {
  return vehicles.some((v) => v.type === 'train' && v.motion != null)
}

export function trainInFrance(
  v: Vehicle,
  inZone: (lon: number, lat: number) => boolean,
): boolean {
  if (inZone(v.lon, v.lat)) return true
  if (!v.motion) return false
  return (
    inZone(v.motion.fromLon, v.motion.fromLat) || inZone(v.motion.toLon, v.motion.toLat)
  )
}
