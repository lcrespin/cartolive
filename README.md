# breathe.live

Real-time transport map (France) with ADEME / Impact CO₂ factors. Monorepo: `frontend/` (Vite + MapLibre) and `backend/` (Fastify).

## Usage

```bash
cp backend/.env.example backend/.env   # configure keys and URLs
npm install
npm run dev
```

| URL | |
|---|---|
| Map | http://localhost:5173 |
| API | http://localhost:3001 |
| Health | http://localhost:3001/api/health |
| Feed monitor | http://localhost:3001/monitoring |

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Backend + frontend |
| `npm run dev:backend` | Backend only |
| `npm run dev:frontend` | Frontend only |
| `npm run build` | Typecheck + compile backend and frontend |
| `npm run build:backend` | Backend `tsc` only |
| `npm run build:frontend` | Frontend Vite production build |
| `npm run preview` | Serve built frontend (`frontend/dist`) |
| `npm run refresh:co2-factors` | Update `backend/data/co2-factors.snapshot.json` from Impact CO2 (restart backend after) |

### Production build locally

The API is not embedded in the static frontend. Run **both** the backend and the preview server:

```bash
npm run build
npm run dev:backend    # terminal 1 — API + WebSocket on :3001
npm run preview        # terminal 2 — minified app on http://localhost:4173
```

`vite preview` proxies `/api` and `/ws` to the backend (same as `npm run dev`). Use this for Lighthouse and performance checks; use `npm run dev` for everyday development.

### HTTP / WebSocket

| Endpoint | |
|---|---|
| `WS /ws/vehicles` | Live vehicle positions |
| `GET /api/vehicles` | Same snapshot over HTTP |
| `GET /api/co2/factors` | Emission factors (g CO₂e / passenger·km) |
| `GET /api/health` | Feed status (JSON): `ok` (API up), `allFeedsOk`, `feeds`, `satellites`, `road`, `vehicles` |
| `GET /monitoring` | Feed status dashboard (HTML, polls `/api/health`) |
| `GET /api/satellites/tle?group=stations` | TLE data (`stations`, `starlink`, `gps-ops`, `weather`) |
| `GET /api/road/traffic` | Road traffic GeoJSON |
| `GET /api/geo/france-zone` | Metropolitan France land + EEZ polygons (display filter) |

Objects and layers are shown only inside **metropolitan France + métropole EEZ** (point-in-polygon), not the rectangular OpenSky/AIS query box. Geometry: admin regions ([france-geojson](https://github.com/gregoiredavid/france-geojson)) + EEZ ([Marine Regions](https://www.marineregions.org/)).

## Live feeds

Sources used by default (override via `backend/.env` where noted). Check `/api/health` if a feed is down or empty.

| Layer | Source | Default URL |
|---|---|---|
| **Planes** | [OpenSky Network](https://opensky-network.org) states API (France bbox) | https://opensky-network.org/api/states/all — OAuth2 optional (`OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`) |
| **Boats** | [AISstream](https://aisstream.io) WebSocket | `wss://stream.aisstream.io/v0/stream` — requires `AISSTREAM_API_KEY` |
| **Trains** | SNCF GTFS-RT trip updates + static GTFS stops | Trip updates: https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates — Stops: https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip (`SNCF_GTFS_RT_URL`, `SNCF_GTFS_STATIC_URL`). Positions are **approximate** (next stop). |
| **Buses & metro (Paris)** | IDFM | If `IDFM_GTFS_RT_URL` is set: that VehiclePositions feed. Otherwise trip updates http://gtfsidfm.clarifygdps.com/gtfs-rt-trips-idfm + stops https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/exports/csv — **approximate** next-stop positions. Official SIRI: [PRIM](https://prim.iledefrance-mobilites.fr). |
| **Buses (other cities)** | GTFS-RT VehiclePositions | See list below (`GTFS_RT_FEEDS` to override) |

Extra-city bus feeds (merged into the `bus` layer with city prefixes):

- Lyon — https://proxy.transport.data.gouv.fr/resource/tcl-lyon-gtfs-rt-vehicle-position
- Marseille — https://proxy.transport.data.gouv.fr/resource/rtm-marseille-gtfs-rt-vehicle-position
- Toulouse — https://api.tisseo.fr/opendata/gtfsrt/GtfsRt.pb
- Bordeaux — https://bdx.mecatran.com/utw/ws/gtfsfeed/vehicles/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt
- Nantes — https://proxy.transport.data.gouv.fr/resource/naolib-nantes-gtfs-rt-vehicle-position
- Lille — https://proxy.transport.data.gouv.fr/resource/ilevia-lille-gtfs-rt

**Not on the vehicle hub** (separate map overlays / APIs):

| Layer | Source | URL |
|---|---|---|
| **Satellites** | [CelesTrak](https://celestrak.org) TLE (cached in backend) | `GET /api/satellites/tle?group=` — e.g. https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE |
| **Road traffic** | Bison Futé Tipi open data | QTV: http://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/QTV-DIR/qtvDir.xml — geometry: http://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/QTV-DIR/refDir.csv (`BISON_FUTE_URL`, `BISON_FUTE_REF_URL`) |

## Configuration

All backend settings live in **`backend/.env`**. Copy from **`backend/.env.example`** (comments document each variable and defaults).

| Variable | Notes |
|---|---|
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | [OpenSky](https://opensky-network.org) OAuth2; empty = anonymous (lower quota) |
| `AISSTREAM_API_KEY` | [aisstream.io](https://aisstream.io) — boats |
| `IMPACT_CO2_API_KEY` | [impactco2.fr](https://impactco2.fr) — refresh script only |
| `IMPACT_CO2_BOAT_G_PER_PASSENGER_KM` | Refresh script only (maritime factor not in Impact CO2 transport API) |
| `IMPACT_CO2_BOAT_ADEME_LABEL` | Optional label in CO₂ snapshot (refresh only) |
| `IDFM_GTFS_RT_URL` | Optional true VehiclePositions for Paris; empty = approximate IDFM fallback |
| `GTFS_RT_FEEDS` | JSON override for extra-city bus GTFS-RT feeds |
| `BISON_FUTE_URL` / `BISON_FUTE_REF_URL` | Optional Bison Futé source URLs |
| `SNCF_*`, `IDFM_*` | Train / Paris bus feed URLs (see `.env.example`) |

**CO₂ at runtime** reads `backend/data/co2-factors.snapshot.json` only. Run `npm run refresh:co2-factors` when you want new ADEME / Impact CO2 values.

Product notes and architecture: `plan/PROJECT.md`, `plan/PLAN.md`. Root `index.html` is an old UI prototype.
