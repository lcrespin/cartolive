import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import type { VehicleMotionLeg } from '../types/motion.js'

const { transit_realtime } = GtfsRealtimeBindings

type StopIndex = Record<string, { lat: number; lon: number; name: string }>

export interface ParsedTrainTrip {
  id: string
  tripId?: string
  routeId?: string
  label: string
  lon: number
  lat: number
  to?: string
  motion?: VehicleMotionLeg
}

type StopTimeEvent = { time?: unknown; delay?: number | null } | null | undefined

function eventTimeMs(ev: StopTimeEvent): number | null {
  if (!ev?.time) return null
  const raw = ev.time as { toNumber?: () => number }
  const sec = typeof raw === 'number' ? raw : typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return null
  return sec * 1000
}

function stopEventMs(
  stu: { arrival?: StopTimeEvent; departure?: StopTimeEvent },
  kind: 'arrival' | 'departure',
): number | null {
  const ev = kind === 'arrival' ? stu.arrival : stu.departure
  return eventTimeMs(ev)
}

function legStartMs(stu: { arrival?: StopTimeEvent; departure?: StopTimeEvent }): number | null {
  return stopEventMs(stu, 'departure') ?? stopEventMs(stu, 'arrival')
}

function legEndMs(stu: { arrival?: StopTimeEvent; departure?: StopTimeEvent }): number | null {
  return stopEventMs(stu, 'arrival') ?? stopEventMs(stu, 'departure')
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

function positionAlongLeg(
  from: { lon: number; lat: number },
  to: { lon: number; lat: number; name: string },
  startMs: number,
  endMs: number,
  nowMs: number,
): { lon: number; lat: number; motion: VehicleMotionLeg } {
  const motion: VehicleMotionLeg = {
    fromLon: from.lon,
    fromLat: from.lat,
    toLon: to.lon,
    toLat: to.lat,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    toLabel: to.name,
  }
  const span = endMs - startMs
  const t = span > 0 ? Math.min(1, Math.max(0, (nowMs - startMs) / span)) : 0
  return {
    lon: from.lon + t * (to.lon - from.lon),
    lat: from.lat + t * (to.lat - from.lat),
    motion,
  }
}

export function parseTrainTripUpdates(buffer: Uint8Array, stops: StopIndex, nowMs = Date.now()): ParsedTrainTrip[] {
  const feed = transit_realtime.FeedMessage.decode(buffer)
  const out: ParsedTrainTrip[] = []

  for (const entity of feed.entity) {
    const tu = entity.tripUpdate
    if (!tu) continue
    const tripId = tu.trip?.tripId ?? undefined
    const routeId = tu.trip?.routeId ?? undefined
    const id = String(entity.id || tripId || routeId || '')
    if (!id) continue

    const label = humanTrainLabel(tripId, routeId, id)
    const rawStops = (tu.stopTimeUpdate ?? []).filter((s) => s.stopId)
    if (rawStops.length === 0) continue

    const ordered = [...rawStops].sort((a, b) => (a.stopSequence ?? 0) - (b.stopSequence ?? 0))

    let placed = false
    for (let i = 0; i < ordered.length - 1; i++) {
      const fromId = String(ordered[i].stopId)
      const toId = String(ordered[i + 1].stopId)
      const fromStop = stops[fromId]
      const toStop = stops[toId]
      if (!fromStop || !toStop) continue

      const startMs = legStartMs(ordered[i])
      const endMs = legEndMs(ordered[i + 1])
      if (startMs == null || endMs == null || endMs <= startMs) continue

      if (nowMs >= startMs && nowMs <= endMs) {
        const { lon, lat, motion } = positionAlongLeg(fromStop, toStop, startMs, endMs, nowMs)
        out.push({ id, tripId, routeId, label, lon, lat, to: toStop.name, motion })
        placed = true
        break
      }
    }

    if (placed) continue

    // Before first leg or after last: snap to nearest stop in sequence with known coords
    for (let i = 0; i < ordered.length; i++) {
      const stop = stops[String(ordered[i].stopId)]
      if (!stop) continue
      const startMs = legStartMs(ordered[i])
      const next = ordered[i + 1]
      const nextStop = next ? stops[String(next.stopId)] : undefined
      if (next && nextStop) {
        const endMs = legEndMs(next)
        const legStart = startMs ?? legStartMs(next)
        if (legStart != null && endMs != null && endMs > legStart && nowMs < legStart) {
          out.push({
            id,
            tripId,
            routeId,
            label,
            lon: stop.lon,
            lat: stop.lat,
            to: stop.name,
            motion: {
              fromLon: stop.lon,
              fromLat: stop.lat,
              toLon: nextStop.lon,
              toLat: nextStop.lat,
              startAt: new Date(legStart).toISOString(),
              endAt: new Date(endMs).toISOString(),
              toLabel: nextStop.name,
            },
          })
          placed = true
          break
        }
      }
      if (i === ordered.length - 1 || (startMs != null && nowMs >= startMs)) {
        out.push({
          id,
          tripId,
          routeId,
          label,
          lon: stop.lon,
          lat: stop.lat,
          to: stop.name,
        })
        placed = true
        break
      }
    }

    if (!placed) {
      const first = stops[String(ordered[0].stopId)]
      if (first) {
        out.push({ id, tripId, routeId, label, lon: first.lon, lat: first.lat, to: first.name })
      }
    }
  }

  return out
}
