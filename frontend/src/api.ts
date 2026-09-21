import type { Co2Factors, Vehicle } from './types'

const factorsUrl = '/api/co2/factors'

export async function fetchCo2Factors(): Promise<Co2Factors> {
  const res = await fetch(factorsUrl)
  if (!res.ok) throw new Error(`CO2 factors ${res.status}`)
  return res.json() as Promise<Co2Factors>
}

export type VehiclesHandler = (vehicles: Vehicle[]) => void

export function connectVehiclesWs(onVehicles: VehiclesHandler): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}/ws/vehicles`
  let ws: WebSocket | null = null
  let closed = false
  let retryMs = 1000

  const connect = () => {
    if (closed) return
    ws = new WebSocket(url)
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type?: string; vehicles?: Vehicle[] }
        if (msg.vehicles) onVehicles(msg.vehicles)
      } catch {
        // ignore malformed
      }
    }
    ws.onopen = () => {
      retryMs = 1000
    }
    ws.onclose = () => {
      if (closed) return
      setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 15_000)
    }
  }

  connect()
  return () => {
    closed = true
    ws?.close()
  }
}
