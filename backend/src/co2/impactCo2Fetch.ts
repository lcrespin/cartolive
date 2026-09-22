import type { Co2Factors } from '../types/vehicle.js'

const API_BASE = 'https://impactco2.fr/api/v1/transport'

export interface ImpactCo2ModeMapping {
  impactCo2Id: number
  impactCo2Name: string
  kgCo2ePerPassengerKm: number
  gCo2ePerPassengerKm: number
}

export interface Co2FactorsSnapshot extends Co2Factors {
  capturedAt: string
  mapping: {
    plane: ImpactCo2ModeMapping
    train: ImpactCo2ModeMapping
    boat: ImpactCo2ModeMapping
    bus: ImpactCo2ModeMapping
  }
}

interface TransportRow {
  id?: number
  name?: string
  slug?: string
  value?: number
}

const PLANE_ID = 1
const TRAIN_ID = 2
const BUS_ID = 9

const BOAT_NAME =
  /^(ferry|bateau|navire|traversée|ro-pax|ro\/pax)|\b(ferry|navire|maritime|pétrolier|ro-pax)\b/i

function isMaritimeBoatMode(name: string): boolean {
  const n = name.toLowerCase()
  if (/vélo|velo|cargo triporteur|triporteur|vae\b/.test(n)) return false
  return BOAT_NAME.test(name)
}

function headers(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (apiKey.trim()) h.Authorization = `Bearer ${apiKey.trim()}`
  return h
}

async function fetchTransportById(id: number, apiKey: string): Promise<TransportRow | null> {
  const url = `${API_BASE}?km=1&transports=${id}`
  const res = await fetch(url, { headers: headers(apiKey) })
  if (!res.ok) throw new Error(`Impact CO2 ${res.status} for transport id ${id}`)
  const data = (await res.json()) as { data?: TransportRow[] }
  const row = data.data?.[0]
  return row?.value != null ? row : null
}

async function fetchCatalog(apiKey: string): Promise<TransportRow[]> {
  const url = `${API_BASE}?km=1&displayAll=1`
  const res = await fetch(url, { headers: headers(apiKey) })
  if (!res.ok) throw new Error(`Impact CO2 catalog ${res.status}`)
  const data = (await res.json()) as { data?: TransportRow[] }
  return data.data ?? []
}

function rowToMapping(row: TransportRow): ImpactCo2ModeMapping {
  const kg = row.value ?? 0
  return {
    impactCo2Id: row.id ?? 0,
    impactCo2Name: row.name ?? 'unknown',
    kgCo2ePerPassengerKm: kg,
    gCo2ePerPassengerKm: kg * 1000,
  }
}

function findBoatInCatalog(catalog: TransportRow[]): TransportRow | null {
  for (const row of catalog) {
    const name = String(row.name ?? '')
    if (isMaritimeBoatMode(name)) return row
  }
  return null
}

export async function fetchCo2FactorsSnapshot(
  apiKey = '',
  opts?: { boatOverride?: { gCo2ePerPassengerKm: number; impactCo2Id: number; impactCo2Name: string } },
): Promise<Co2FactorsSnapshot> {
  const [planeRow, trainRow, busRow, catalog] = await Promise.all([
    fetchTransportById(PLANE_ID, apiKey),
    fetchTransportById(TRAIN_ID, apiKey),
    fetchTransportById(BUS_ID, apiKey),
    fetchCatalog(apiKey),
  ])

  if (!planeRow || !trainRow || !busRow) {
    throw new Error(
      'Impact CO2 transport API did not return plane (id 1), TGV (id 2), or Bus thermique (id 9). ' +
        'Try setting IMPACT_CO2_API_KEY in backend/.env and run refresh again.',
    )
  }

  let boatRow = findBoatInCatalog(catalog)
  let boatMapping: ImpactCo2ModeMapping
  if (boatRow) {
    boatMapping = rowToMapping(boatRow)
  } else if (opts?.boatOverride) {
    boatMapping = {
      impactCo2Id: opts.boatOverride.impactCo2Id,
      impactCo2Name: opts.boatOverride.impactCo2Name,
      kgCo2ePerPassengerKm: opts.boatOverride.gCo2ePerPassengerKm / 1000,
      gCo2ePerPassengerKm: opts.boatOverride.gCo2ePerPassengerKm,
    }
  } else {
    throw new Error(
      'No ferry / maritime mode in Impact CO2 /api/v1/transport catalog. ' +
        'Set IMPACT_CO2_BOAT_G_PER_PASSENGER_KM when refreshing, or preserve a previous snapshot boat value.',
    )
  }

  const capturedAt = new Date().toISOString()
  const mapping = {
    plane: rowToMapping(planeRow),
    train: rowToMapping(trainRow),
    bus: rowToMapping(busRow),
    boat: boatMapping,
  }

  return {
    plane: mapping.plane.gCo2ePerPassengerKm,
    train: mapping.train.gCo2ePerPassengerKm,
    boat: mapping.boat.gCo2ePerPassengerKm,
    bus: mapping.bus.gCo2ePerPassengerKm,
    source: 'Base Empreinte® ADEME via Impact CO2 (snapshot)',
    updatedAt: capturedAt,
    capturedAt,
    mapping,
  }
}
