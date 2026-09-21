import type { Co2Factors } from '../types/vehicle.js'

/** ADEME / Impact CO2 order-of-magnitude fallbacks (gCO2e / passenger.km). */
const FALLBACK: Co2Factors = {
  plane: 230,
  train: 3,
  boat: 15,
  bus: 68,
  source: 'Hardcoded ADEME-order fallback (Impact CO2 unavailable)',
  updatedAt: new Date(0).toISOString(),
}

let cache: Co2Factors = { ...FALLBACK }
let loadedAt = 0
const CACHE_TTL_MS = 24 * 60 * 60_000

/**
 * Impact CO2 transport IDs (common set):
 * plane ≈ avion, TGV, ferry/boat, bus — mapped from /api/v1/transport?km=1&displayAll=1
 */
export async function getCo2Factors(): Promise<Co2Factors> {
  if (Date.now() - loadedAt < CACHE_TTL_MS && loadedAt > 0) return cache

  try {
    const key = process.env.IMPACT_CO2_API_KEY
    const url = new URL('https://impactco2.fr/api/v1/transport')
    url.searchParams.set('km', '1')
    url.searchParams.set('displayAll', '1')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (key) headers['Authorization'] = `Bearer ${key}`

    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`Impact CO2 ${res.status}`)
    const data = (await res.json()) as {
      data?: Array<{ id?: number | string; name?: string; value?: number; slug?: string }>
    }
    const items = data.data ?? []
    const bySlug = (pred: (s: string, name: string) => boolean) => {
      const hit = items.find((i) => pred(String(i.slug ?? '').toLowerCase(), String(i.name ?? '').toLowerCase()))
      return hit?.value
    }

    // API returns kgCO2e for the requested distance (km=1) → convert to gCO2e / passenger.km
    const toGPerKm = (kgForOneKm: number | undefined, fallback: number) =>
      kgForOneKm != null ? kgForOneKm * 1000 : fallback

    const plane = toGPerKm(
      bySlug((s, n) => s.includes('avion') || n.includes('avion') || s.includes('plane')),
      FALLBACK.plane,
    )
    const train = toGPerKm(
      bySlug((s, n) => s.includes('tgv') || n === 'tgv' || (n.includes('train') && n.includes('grande'))),
      FALLBACK.train,
    )
    const boat = toGPerKm(
      bySlug(
        (s, n) =>
          s.includes('ferry') ||
          n.includes('ferry') ||
          s.includes('bateau') ||
          n.includes('bateau') ||
          n.includes('navire'),
      ),
      FALLBACK.boat,
    )
    const bus = toGPerKm(
      bySlug((s, n) => s.includes('bus') || n.includes('bus thermique') || n === 'bus' || s.includes('autocar')),
      FALLBACK.bus,
    )

    cache = {
      plane,
      train,
      boat,
      bus,
      source: 'Base Empreinte® ADEME via Impact CO2 API',
      updatedAt: new Date().toISOString(),
    }
    loadedAt = Date.now()
    console.log('[impactco2] factors refreshed')
    return cache
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[impactco2] using fallback factors:', msg)
    if (loadedAt === 0) {
      cache = { ...FALLBACK, updatedAt: new Date().toISOString() }
      loadedAt = Date.now()
    }
    return cache
  }
}
