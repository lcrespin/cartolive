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

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Average speed along the current GTFS-RT leg (chord distance / scheduled interval). */
export function trainLegSpeedKmh(motion: VehicleMotionLeg): number | null {
  const startMs = new Date(motion.startAt).getTime()
  const endMs = new Date(motion.endAt).getTime()
  const hours = (endMs - startMs) / 3_600_000
  if (!Number.isFinite(hours) || hours <= 0) return null
  const km = haversineKm(motion.fromLon, motion.fromLat, motion.toLon, motion.toLat)
  if (!Number.isFinite(km) || km <= 0) return null
  return km / hours
}

export function trainPopupSpeedKmh(v: Vehicle): { kmh: number; estimated: boolean } | null {
  if (v.speedKmh != null && Number.isFinite(v.speedKmh)) {
    return { kmh: v.speedKmh, estimated: false }
  }
  if (v.motion) {
    const kmh = trainLegSpeedKmh(v.motion)
    if (kmh != null) return { kmh, estimated: true }
  }
  return null
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
