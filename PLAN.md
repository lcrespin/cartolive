# breathe.live — MVP build plan

Product brief: [PROJECT.md](PROJECT.md). Visual prototype: [index.html](index.html).

This document records **decisions you locked** and the build sequence. Nothing here is executed until you explicitly approve implementation.

---

## 1. Decisions locked

| Topic | Choice |
|---|---|
| Brand | `breathe.live` |
| Frontend | Vite + TypeScript, English UI (bilingual later) |
| Backend | Node.js + Fastify + TypeScript |
| Repo | Monorepo: `frontend/` + `backend/` |
| Basemap | OpenFreeMap dark (switched from CARTO — API key now required) |
| Transport | Hybrid: WebSocket for live positions, HTTP for CO2 factors |
| Feeds (day one) | OpenSky (planes), AISstream (boats), SNCF GTFS-RT (trains), IDFM GTFS-RT only (buses/metro) |
| CO2 | Factor per mode + popup + live cumulative counter; **no** meal equivalent |
| Hosting | Local only (no deployment in this phase) |
| Out of scope now | Satellites, Bison Futé, 3D globe, Level 2/3 CO2 features, extra GTFS cities |

---

## 2. Baseline

- **[index.html](index.html)** — MapLibre prototype with layer toggles, popups, cumulative CO2, simulated motion. Reuse visual tokens, layer UX, and circle/halo layers. Replace simulation; rebrand to `breathe.live` in English; switch basemap to CARTO dark; remove meal-equivalent UI.
- **[PROJECT.md](PROJECT.md)** — Source of truth for data sources, TTLs, and architecture rationale.

---

## 3. Target architecture

```
┌─────────────────────────────────────────────────────┐
│  frontend/  (Vite + TypeScript)                      │
│  MapLibre GL + OpenFreeMap dark                      │
│  Layers: plane / train / boat / bus                  │
│  WS client → live vehicles                           │
│  HTTP client → CO2 factors                           │
└───────────────────────┬─────────────────────────────┘
                        │ WS / HTTP (local)
┌───────────────────────▼─────────────────────────────┐
│  backend/  (Fastify + TypeScript)                    │
│  In-memory position hub + Impact CO2 cache           │
│  Pollers: OpenSky, SNCF GTFS-RT, IDFM GTFS-RT        │
│  Push: AISstream WebSocket                           │
│  Expose: /ws/vehicles, /api/co2/factors, /api/health │
└───────────────────────┬─────────────────────────────┘
                        │
     OpenSky · AISstream · SNCF · IDFM · Impact CO2
```

### Why a backend (unchanged from PROJECT.md)

- Keeps API credentials server-side
- One poller shared by all local clients (quota-safe)
- Normalizes heterogeneous feed formats

---

## 4. Repo layout

```
cartolive/
  frontend/       # Vite + TypeScript + MapLibre
  backend/        # Fastify + TypeScript + pollers
  PROJECT.md      # product brief (keep)
  PLAN.md         # this build plan
  index.html      # prototype reference (not the served app)
```

No deployment configs in this phase.

Vehicle types are **mirrored** in frontend and backend (no shared package until you approve monorepo tooling).

---

## 5. Normalized vehicle payload (WS)

```ts
{
  id: string
  type: 'plane' | 'train' | 'boat' | 'bus'
  label: string
  lon: number
  lat: number
  heading?: number
  from?: string
  to?: string
  distanceKm?: number
  speedKmh?: number
  passengers?: number
  updatedAt: string
}
```

---

## 6. Phases

### Phase 1 — Scaffold

1. Create `frontend/` (Vite + TypeScript); port UI from `index.html`:
   - Brand `breathe.live`, English copy
   - Layer toggles: Planes / Trains / Boats / Buses & metro
   - CO2 panel: live cumulative only (no meal equivalent)
   - Popup: mode, label, trip/distance when known, passengers if available, CO₂ factor / per-passenger when computable
   - MapLibre + CARTO dark (replace Natural Earth self-drawn style)
2. Create `backend/` (Fastify + TypeScript), CORS for Vite origin, `.env` + `backend/.env.example`.

### Phase 2 — Backend hub + hybrid API

1. **In-memory store** keyed by `type:id`, TTLs per PROJECT.md:
   - OpenSky ~10–15s
   - AISstream continuous
   - GTFS-RT ~30s
   - Impact CO2 long TTL
2. **WebSocket** `/ws/vehicles` — snapshot on connect, then updates (start with periodic full snapshots per type; diffs later only if needed).
3. **HTTP** `GET /api/co2/factors` — ADEME / Impact CO2 factors by mode, heavily cached.
4. **HTTP** `GET /api/health` — liveness + last-success per feed.
5. France-first bounding boxes where APIs support them (OpenSky, AIS).

### Phase 3 — Connectors (implementation order)

1. **OpenSky** (planes) — OAuth2; France bbox; normalize.
2. **AISstream** (boats) — server-side WS; French coastal/inland bbox; into hub.
3. **SNCF GTFS-RT** (trains) — day one; protobuf; only entities with coordinates.
4. **IDFM GTFS-RT** (buses/metro) — one feed; same generic GTFS-RT parser as SNCF.
5. **Impact CO2** — real factors; cite ADEME / Base Empreinte in the UI source note (English).

Secrets server-side only, e.g. `OPENSKY_*`, `AISSTREAM_API_KEY`, `IMPACT_CO2_API_KEY`, plus any GTFS tokens if required.

### Phase 4 — Frontend wiring

1. Remove simulated `makeVehicle` / `tick()`.
2. WS → MapLibre GeoJSON sources; keep prototype circle + halo colors.
3. HTTP fetch CO2 factors (long refresh interval).
4. Popup + cumulative `kg CO₂e / h` from visible layers (factor × speed / rate); no meal comparison.
5. Drop simulated-data banner once feeds are live; optional live status from WS/health.

### Phase 5 — Local DX

- Scripts: `dev:frontend`, `dev:backend` (and/or concurrent `dev`).
- Root `README.md` (English): how to run locally and obtain API keys.
- No Fly / Netlify / Cloudflare setup.

---

## 7. Explicit non-goals

- Satellites / `satellite.js`, Bison Futé, globe.gl
- GTFS cities beyond IDFM
- Level 2 A→B comparator, simulation mode, meal equivalents
- Redis, production hosting, domain purchase
- French UI primary (English now; bilingual later)

---

## 8. Implementation checklist (when you approve execution)

1. Scaffold monorepo + port UI (brand, CARTO, English, no meal UI)
2. Fastify hub + WS + CO2 HTTP (+ Impact CO2)
3. OpenSky → live planes on map
4. AISstream → boats
5. Generic GTFS-RT → SNCF trains + IDFM buses
6. CO2 popup + live cumulative on real data
7. README + `.env.example`

---

## 9. Open items (ask you before changing)

Any change to the locked table in §1, feed list, CO2 UX, or scope requires your explicit decision first.

## 10. Implementation notes (as built)

- OpenSky works anonymously (OAuth2 optional via env).
- SNCF has **no public VehiclePositions** feed → trains are placed at the **next stop** from trip updates + static GTFS (approximate).
- IDFM buses/metro require `IDFM_GTFS_RT_URL` (VehiclePositions). Official IDFM real-time is mostly SIRI Lite on PRIM.
- AISstream requires `AISSTREAM_API_KEY`.
- Impact CO2 values from `/api/v1/transport?km=1` are converted kg→g/passenger·km.
