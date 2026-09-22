/**
 * Admin: refresh ADEME / Impact CO2 emission factors snapshot (calls impactco2.fr once).
 *
 * Usage (from repo root):
 *   npm run refresh:co2-factors
 */
import dotenv from 'dotenv'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchCo2FactorsSnapshot } from '../src/co2/impactCo2Fetch.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '..')
const snapshotPath = path.join(backendRoot, 'data/co2-factors.snapshot.json')

dotenv.config({ path: path.join(backendRoot, '.env') })

function boatOverrideFromEnv(): {
  gCo2ePerPassengerKm: number
  impactCo2Name: string
  impactCo2Id: number
} | null {
  const raw = process.env.IMPACT_CO2_BOAT_G_PER_PASSENGER_KM?.trim()
  if (!raw) return null
  const g = Number(raw)
  if (!Number.isFinite(g) || g <= 0) return null
  const label =
    process.env.IMPACT_CO2_BOAT_ADEME_LABEL?.trim() ||
    'ADEME Base Empreinte (manual — no maritime mode in Impact CO2 /api/v1/transport)'
  return { gCo2ePerPassengerKm: g, impactCo2Name: label, impactCo2Id: 0 }
}

async function readPreviousBoat(): Promise<{
  gCo2ePerPassengerKm: number
  impactCo2Name: string
  impactCo2Id: number
} | null> {
  try {
    const raw = await readFile(snapshotPath, 'utf8')
    const prev = JSON.parse(raw) as {
      boat?: number
      mapping?: { boat?: { impactCo2Id?: number; impactCo2Name?: string; gCo2ePerPassengerKm?: number } }
    }
    const g = prev.mapping?.boat?.gCo2ePerPassengerKm ?? prev.boat
    const name = prev.mapping?.boat?.impactCo2Name ?? 'previous snapshot (no Impact CO2 maritime mode)'
    if (g == null || !Number.isFinite(g)) return null
    if (/vélo|velo|triporteur/i.test(name)) return null
    return {
      gCo2ePerPassengerKm: g,
      impactCo2Name: name,
      impactCo2Id: prev.mapping?.boat?.impactCo2Id ?? 0,
    }
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.IMPACT_CO2_API_KEY ?? ''
  console.log('[refresh-co2] fetching Impact CO2 transport factors (km=1)…')
  if (!apiKey.trim()) {
    console.warn('[refresh-co2] IMPACT_CO2_API_KEY is empty — public quota may rate-limit you')
  }

  let snapshot
  try {
    snapshot = await fetchCo2FactorsSnapshot(apiKey)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/No ferry|maritime mode/i.test(msg)) throw err
    const boatOverride = boatOverrideFromEnv() ?? (await readPreviousBoat())
    if (!boatOverride) throw err
    console.warn('[refresh-co2]', msg)
    console.warn(
      `[refresh-co2] preserving boat=${boatOverride.gCo2ePerPassengerKm} g/pax·km (${boatOverride.impactCo2Name})`,
    )
    snapshot = await fetchCo2FactorsSnapshot(apiKey, { boatOverride })
  }

  await mkdir(path.dirname(snapshotPath), { recursive: true })
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log('[refresh-co2] wrote', snapshotPath)
  console.log(
    `[refresh-co2] plane=${snapshot.plane} train=${snapshot.train} bus=${snapshot.bus} boat=${snapshot.boat} gCO₂e/pax·km`,
  )
}

void main().catch((err) => {
  console.error('[refresh-co2]', err instanceof Error ? err.message : err)
  process.exit(1)
})
