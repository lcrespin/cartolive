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
import type { Vehicle } from './types/vehicle.js'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: true,
})

await app.register(websocket)

app.get('/api/health', async () => ({
  ok: true,
  feeds: hub.health(),
  vehicles: hub.all().length,
}))

app.get('/api/co2/factors', async () => getCo2Factors())

app.get('/api/vehicles', async () => ({ vehicles: hub.all() }))

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
void getCo2Factors()

await app.listen({ port: PORT, host: HOST })
console.log(`[breathe.live] backend on http://${HOST}:${PORT}`)
