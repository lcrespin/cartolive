import WebSocket from 'ws'
import { hub } from '../hub/store.js'
import type { Vehicle } from '../types/vehicle.js'
import { FRANCE_AIS_BBOX } from '../config/geo.js'

const AIS_URL = 'wss://stream.aisstream.io/v0/stream'
const STALE_MS = 15 * 60_000

interface AisEnvelope {
  MessageType?: string
  MetaData?: {
    MMSI?: string | number
    ShipName?: string
    Latitude?: number
    Longitude?: number
  }
  Message?: {
    PositionReport?: {
      UserID?: number
      Latitude?: number
      Longitude?: number
      Sog?: number
      Cog?: number
      TrueHeading?: number
    }
  }
}

function startSocket(apiKey: string): void {
  const ws = new WebSocket(AIS_URL)

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [FRANCE_AIS_BBOX],
        FilterMessageTypes: ['PositionReport'],
      }),
    )
    hub.setFeedHealth('aisstream', {
      ok: true,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      vehicleCount: hub.countByType('boat'),
    })
    console.log('[aisstream] subscribed')
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as AisEnvelope
      if (msg.MessageType !== 'PositionReport') return
      const report = msg.Message?.PositionReport
      const meta = msg.MetaData
      const lat = report?.Latitude ?? meta?.Latitude
      const lon = report?.Longitude ?? meta?.Longitude
      const mmsi = String(report?.UserID ?? meta?.MMSI ?? '')
      if (lat == null || lon == null || !mmsi) return

      const name = (meta?.ShipName ?? '').trim()
      const vehicle: Vehicle = {
        id: mmsi,
        type: 'boat',
        label: name || `MMSI ${mmsi}`,
        lon,
        lat,
        heading: report?.TrueHeading ?? report?.Cog,
        speedKmh: report?.Sog != null ? report.Sog * 1.852 : undefined,
        updatedAt: new Date().toISOString(),
      }
      hub.upsertMany([vehicle])
      hub.setFeedHealth('aisstream', {
        ok: true,
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        vehicleCount: hub.countByType('boat'),
      })
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      console.error('[aisstream] parse', m)
    }
  })

  ws.on('close', () => {
    console.warn('[aisstream] closed — reconnecting in 5s')
    hub.setFeedHealth('aisstream', {
      ok: false,
      lastError: 'disconnected',
      vehicleCount: hub.countByType('boat'),
    })
    setTimeout(() => startSocket(apiKey), 5000)
  })

  ws.on('error', (err) => {
    console.error('[aisstream]', err.message)
    hub.setFeedHealth('aisstream', {
      ok: false,
      lastError: err.message,
      vehicleCount: hub.countByType('boat'),
    })
  })
}

export function startAisStream(): void {
  const apiKey = process.env.AISSTREAM_API_KEY?.trim()
  if (!apiKey) {
    console.warn('[aisstream] AISSTREAM_API_KEY missing — boats disabled')
    hub.setFeedHealth('aisstream', {
      ok: false,
      lastError: 'AISSTREAM_API_KEY missing',
      vehicleCount: 0,
    })
    return
  }
  startSocket(apiKey)
  setInterval(() => hub.removeStale('boat', STALE_MS), 60_000)
}
