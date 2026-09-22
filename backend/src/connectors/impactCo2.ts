import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Co2Factors } from '../types/vehicle.js'
import type { Co2FactorsSnapshot } from '../co2/impactCo2Fetch.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = path.resolve(__dirname, '../../data/co2-factors.snapshot.json')

/** Last-resort if snapshot file is missing (run `npm run refresh:co2-factors`). */
const EMBEDDED_FALLBACK: Co2Factors = {
  plane: 224.2,
  train: 2.3,
  boat: 18.7,
  bus: 113.5,
  source: 'Embedded fallback — run npm run refresh:co2-factors',
  updatedAt: new Date(0).toISOString(),
}

let cache: Co2Factors | null = null

function toCo2Factors(snap: Co2FactorsSnapshot): Co2Factors {
  return {
    plane: snap.plane,
    train: snap.train,
    boat: snap.boat,
    bus: snap.bus,
    source: snap.source,
    updatedAt: snap.updatedAt,
  }
}

async function loadSnapshot(): Promise<Co2Factors> {
  if (cache) return cache
  try {
    const raw = await readFile(SNAPSHOT_PATH, 'utf8')
    const snap = JSON.parse(raw) as Co2FactorsSnapshot
    if (![snap.plane, snap.train, snap.boat, snap.bus].every(Number.isFinite)) {
      throw new Error('invalid snapshot numbers')
    }
    cache = toCo2Factors(snap)
    return cache
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[impactco2] snapshot missing or invalid, using embedded fallback:', msg)
    cache = { ...EMBEDDED_FALLBACK, updatedAt: new Date().toISOString() }
    return cache
  }
}

export async function getCo2Factors(): Promise<Co2Factors> {
  return loadSnapshot()
}
