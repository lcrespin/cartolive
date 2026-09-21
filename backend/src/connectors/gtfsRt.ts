import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import type { Vehicle, VehicleType } from '../types/vehicle.js'

const { transit_realtime } = GtfsRealtimeBindings

export async function fetchGtfsRtBuffer(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { Accept: 'application/x-protobuf, application/octet-stream, */*' },
  })
  if (!res.ok) throw new Error(`GTFS-RT ${res.status} for ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

export function parseVehiclePositions(
  buffer: Uint8Array,
  type: VehicleType,
  idPrefix = '',
): Vehicle[] {
  const feed = transit_realtime.FeedMessage.decode(buffer)
  const now = new Date().toISOString()
  const out: Vehicle[] = []

  for (const entity of feed.entity) {
    const vp = entity.vehicle
    if (!vp?.position) continue
    const lat = vp.position.latitude
    const lon = vp.position.longitude
    if (lat == null || lon == null) continue

    const vehicleId = vp.vehicle?.id || entity.id || ''
    const label =
      vp.vehicle?.label ||
      vp.trip?.routeId ||
      vp.trip?.tripId ||
      vehicleId ||
      'unknown'

    out.push({
      id: `${idPrefix}${vehicleId || entity.id}`,
      type,
      label: String(label).trim() || 'Vehicle',
      lon,
      lat,
      heading: vp.position.bearing ?? undefined,
      speedKmh: vp.position.speed != null ? vp.position.speed * 3.6 : undefined,
      to: vp.trip?.routeId ?? undefined,
      updatedAt: now,
    })
  }
  return out
}

export function parseTripUpdates(buffer: Uint8Array): Array<{
  id: string
  tripId?: string
  routeId?: string
  stopId?: string
  label: string
}> {
  const feed = transit_realtime.FeedMessage.decode(buffer)
  const out: Array<{
    id: string
    tripId?: string
    routeId?: string
    stopId?: string
    label: string
  }> = []

  for (const entity of feed.entity) {
    const tu = entity.tripUpdate
    if (!tu) continue
    const tripId = tu.trip?.tripId ?? undefined
    const routeId = tu.trip?.routeId ?? undefined
    const stopUpdates = tu.stopTimeUpdate ?? []
    const next = stopUpdates.find((s) => s.stopId) ?? stopUpdates[0]
    const stopId = next?.stopId ?? undefined
    const id = entity.id || tripId || routeId
    if (!id) continue
    out.push({
      id: String(id),
      tripId,
      routeId,
      stopId: stopId ? String(stopId) : undefined,
      label: humanTrainLabel(tripId, routeId, String(id)),
    })
  }
  return out
}

function humanTrainLabel(tripId?: string, routeId?: string, fallback = 'Train'): string {
  const src = tripId || routeId || fallback
  const sncf = src.match(/OCESN(\d+)/i)
  if (sncf) return `Train ${sncf[1]}`
  const tgv = src.match(/TGV[^\d]*(\d+)/i)
  if (tgv) return `TGV ${tgv[1]}`
  if (routeId && routeId.length < 40) return routeId
  return src.length > 48 ? `${src.slice(0, 45)}…` : src
}
