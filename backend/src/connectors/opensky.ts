import { hub } from '../hub/store.js'
import type { Vehicle } from '../types/vehicle.js'
import { FRANCE_BBOX } from '../config/geo.js'

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
const STATES_URL = 'https://opensky-network.org/api/states/all'
const POLL_MS = 12_000

let accessToken: string | null = null
let tokenExpiresAt = 0

async function getToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  if (accessToken && Date.now() < tokenExpiresAt - 60_000) return accessToken

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`OpenSky token ${res.status}`)
  const data = (await res.json()) as { access_token: string; expires_in?: number }
  accessToken = data.access_token
  tokenExpiresAt = Date.now() + (data.expires_in ?? 1800) * 1000
  return accessToken
}

function mapStates(states: unknown[][]): Vehicle[] {
  const now = new Date().toISOString()
  const out: Vehicle[] = []
  for (const s of states) {
    const icao24 = String(s[0] ?? '')
    const callsign = String(s[1] ?? '').trim()
    const lon = s[5] as number | null
    const lat = s[6] as number | null
    const onGround = Boolean(s[8])
    const velocity = s[9] as number | null
    const heading = s[10] as number | null
    const origin = s[2] as string | null
    if (lon == null || lat == null || !icao24) continue
    if (onGround) continue
    out.push({
      id: icao24,
      type: 'plane',
      label: callsign || icao24.toUpperCase(),
      lon,
      lat,
      heading: heading ?? undefined,
      from: origin ?? undefined,
      speedKmh: velocity != null ? velocity * 3.6 : undefined,
      updatedAt: now,
    })
  }
  return out
}

async function poll(): Promise<void> {
  try {
    const token = await getToken()
    const { lamin, lamax, lomin, lomax } = FRANCE_BBOX
    const url = `${STATES_URL}?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`OpenSky states ${res.status}`)
    const data = (await res.json()) as { states?: unknown[][] | null }
    const vehicles = mapStates(data.states ?? [])
    hub.replaceType('plane', vehicles)
    hub.setFeedHealth('opensky', {
      ok: true,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      vehicleCount: vehicles.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[opensky]', msg)
    hub.setFeedHealth('opensky', { ok: false, lastError: msg, vehicleCount: hub.countByType('plane') })
  }
}

export function startOpenSky(): void {
  const hasCreds = Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET)
  console.log(`[opensky] starting (auth=${hasCreds ? 'oauth2' : 'anonymous'})`)
  void poll()
  setInterval(() => void poll(), POLL_MS)
}
