import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const candidates = [
  path.resolve(here, '../.env'), // backend/.env (preferred)
  path.resolve(here, '../../.env'), // repo root .env
]

for (const envPath of candidates) {
  const result = dotenv.config({ path: envPath, override: true })
  if (!result.error) {
    console.log(`[env] loaded ${envPath}`)
    break
  }
}

const present = (name: string) => Boolean(process.env[name]?.trim())
console.log(
  `[env] OPENSKY=${present('OPENSKY_CLIENT_ID') && present('OPENSKY_CLIENT_SECRET')} ` +
    `AISSTREAM=${present('AISSTREAM_API_KEY')} ` +
    `IMPACT_CO2=${present('IMPACT_CO2_API_KEY')} ` +
    `IDFM_GTFS_RT=${present('IDFM_GTFS_RT_URL')}`,
)
