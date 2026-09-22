import './env.js'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { hub } from './hub/store.js'
import { getCo2Factors } from './connectors/impactCo2.js'
import { startOpenSky } from './connectors/opensky.js'
import { startAisStream } from './connectors/aisstream.js'
import { startSncf } from './connectors/sncf.js'
import { startIdfm } from './connectors/idfm.js'
import { getTleGroup, isSatelliteGroup, startCelestrak } from './connectors/celestrak.js'
import { getRoadTraffic, startBisonFute } from './connectors/bisonFute.js'
import { startGtfsCities } from './connectors/gtfsCities.js'
import { getFranceZoneGeoJson, initFranceZone } from './geo/franceZone.js'
import { getHealth } from './health.js'
import { MONITORING_HTML } from './monitoring/page.js'
import type { Vehicle } from './types/vehicle.js'
import { settings } from './config/settings.js'

await initFranceZone()

const PORT = settings.port
const HOST = settings.host

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: true,
})

await app.register(websocket)

app.get('/api/health', async () => getHealth())

app.get('/monitoring', async (_req, reply) => {
  return reply.type('text/html; charset=utf-8').send(MONITORING_HTML)
})

app.get('/api/co2/factors', async () => getCo2Factors())

app.get('/api/vehicles', async () => ({ vehicles: hub.all() }))

app.get('/api/satellites/tle', async (req, reply) => {
  const q = (req.query as { group?: string }).group ?? 'stations'
  if (!isSatelliteGroup(q)) {
    return reply.code(400).send({
      error: `unknown group "${q}"`,
      groups: ['stations', 'starlink', 'gps-ops', 'weather'],
    })
  }
  const records = await getTleGroup(q)
  return { group: q, count: records.length, records }
})

app.get('/api/road/traffic', async () => getRoadTraffic())

app.get('/api/geo/france-zone', async () => getFranceZoneGeoJson())

app.get('/ws/vehicles', { websocket: true }, (socket) => {
  const send = (vehicles: Vehicle[]) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'snapshot', vehicles }))
    }
  }
  send(hub.all())
  const unsub = hub.subscribe(send)
  socket.on('close', () => unsub())
})

startOpenSky()
startAisStream()
void startSncf()
void startIdfm()
startGtfsCities()
startBisonFute()
void startCelestrak()
void getCo2Factors()

await app.listen({ port: PORT, host: HOST })
console.log(`[breathe.live] backend on http://${HOST}:${PORT}`)
