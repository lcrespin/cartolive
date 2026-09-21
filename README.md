# breathe.live

Real-time multimodal transport map for France with carbon footprint factors from ADEME / Impact CO2.

## Stack

- **frontend/** — Vite + TypeScript + MapLibre GL (OpenFreeMap dark)
- **backend/** — Fastify + TypeScript (proxy, cache, WebSocket hub)

## Quick start

```bash
cp backend/.env.example backend/.env
# fill in keys you have (OpenSky, AISstream, Impact CO2, IDFM feed URL)

npm install
npm run dev
```

- Map UI: http://localhost:5173  
- Backend: http://localhost:3001  
- Health: http://localhost:3001/api/health  

## API keys

| Variable | Required? | Where |
|---|---|---|
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | Recommended | [OpenSky Account](https://opensky-network.org) → API client (OAuth2). Anonymous works with low quota. |
| `AISSTREAM_API_KEY` | For boats | [aisstream.io](https://aisstream.io) |
| `IMPACT_CO2_API_KEY` | Optional | [impactco2.fr](https://impactco2.fr) — falls back to hardcoded ADEME-order factors |
| `IDFM_GTFS_RT_URL` | Optional | Real GTFS-RT **VehiclePositions** URL if you have one |
| _(default)_ | — | Without `IDFM_GTFS_RT_URL`, buses/metro use a community [GTFS-RT trip-updates](http://gtfsidfm.clarifygdps.com/gtfs-rt-trips-idfm) feed + IDFM `arrets-lignes` stops (approximate next-stop positions) |

### SNCF trains

Uses public GTFS-RT **trip updates** plus static GTFS stop coordinates. Positions are **approximate** (placed at the next known stop), because SNCF does not publish a public vehicle-positions feed. Static GTFS default:

`https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip`

### IDFM buses & metro

Official IDFM real-time is mostly SIRI Lite on [PRIM](https://prim.iledefrance-mobilites.fr) (token required). By default this app uses:

1. Trip updates from `http://gtfsidfm.clarifygdps.com/gtfs-rt-trips-idfm` (community SIRI→GTFS-RT bridge)
2. Stop coordinates from IDFM open data `arrets-lignes`

Positions are **approximate** (next stop). Override with `IDFM_GTFS_RT_URL` when you have a true vehicle-positions feed.
## Protocol

- `WS /ws/vehicles` — JSON `{ type: "snapshot", vehicles: Vehicle[] }`
- `GET /api/co2/factors` — emission factors by mode (gCO₂e / passenger·km)
- `GET /api/health` — feed status

## Prototype

`index.html` at the repo root is the original simulated prototype (reference only).
