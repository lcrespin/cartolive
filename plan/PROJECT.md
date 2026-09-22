# Aire·Live — Real-time Multimodal Transport Map & Carbon Footprint

## 1. Project pitch

A cartographic website displaying the real-time position of as many transport modes as possible (trains, planes, boats, buses/metro, eventually bike-share and satellites), with a differentiating angle: **making the carbon footprint of live traffic visible**, based on official ADEME (French environment agency) emission factors.

This is not a FlightRadar24/MarineTraffic clone — those sites have no environmental dimension at all. The goal is to make it an awareness tool grounded in real, verifiable data, without being preachy: the raw, sourced numbers should speak for themselves.

**Geographic scope**: France first (MVP), with a possible extension to Europe/worldwide depending on free API quotas.

**Budget constraint**: near zero. The project must run on free or very low-cost APIs and hosting (target: €15–50 for the first year, ~€15/year afterwards — essentially domain name + a possible small VPS).

**Scope principle**: only **mobile entities with real-time positions** (points that move). No static location data (charging stations, carpooling spots, delivery zones, POIs...) — road traffic (Bison Futé) is a tolerated exception as a network-state layer, not an individually tracked object.

---

## 2. Selected data sources

| Category | Source | Data nature | Access | Notes |
|---|---|---|---|---|
| Planes | [OpenSky Network](https://opensky-network.org) | Point position (ADS-B) | Free, daily credit quota (~400/day anonymous, ~8000/day if contributing with an ADS-B receiver). **OAuth2 auth required since March 2026** (no more simple user/password) | Reasonably good worldwide coverage |
| Boats | [AISstream.io](https://aisstream.io) | Point position (AIS), WebSocket | Free with reasonable quotas for non-commercial use | Alternative: AISHub (free but requires contributing data via an AIS receiver) |
| Trains | SNCF Open Data ([data.sncf.com](https://data.sncf.com)) + GTFS-RT | Point position / schedules | Free | Partial real-time coverage (not all trains have a public GPS position). Eurostar also publishes a GTFS-RT feed (~30s updates) |
| Buses / Metro / Tram | **Generic GTFS-RT connector** via [transport.data.gouv.fr](https://transport.data.gouv.fr) (the French National Access Point) | Point position | Free, very high volume (hundreds of networks: RATP/IDFM, TCL Lyon, Tisséo Toulouse, TAN Nantes, Vitalis Poitiers, etc.) | See section 3 — a key building block of the project |
| Bike-share / e-scooters (optional) | GBFS (referenced by the National Access Point) | Individual vehicle position | Free | Vélib', Vélo'v, Lime/Dott/Tier... |
| Satellites | [CelesTrak](https://celestrak.org) (TLE) | Orbital parameters, **not a direct position** | Free | Requires an SGP4 calculation client-side (`satellite.js` library) — see section 3 |
| Road traffic | Bison Futé (diffusion-numerique.info-routiere.gouv.fr) | Road segment state (smooth/heavy/congested), not an individual moving object | Free | Updated every ~6 min, ~15 major metro areas + national network. Independent overlay layer, not a moving point |
| Carbon footprint | [Impact CO2 API](https://impactco2.fr) (ADEME, Base Empreinte®) | Emission factors (gCO2e/km/passenger) by mode | Free, API key on request | Fairly stable data → heavy caching on the backend |

### Sources explicitly ruled out or to avoid
- **FlightRadar24 API**: paid, pro plans at several hundred €/month — out of budget
- **MarineTraffic API**: paid for any real usage — out of budget
- Any **static location** data (charging stations, carpooling spots, delivery zones) — outside the scope the user wants

---

## 3. Important technical points to keep in mind

### 3.1 Generic GTFS-RT connector (priority building block)
Rather than writing an ad hoc connector per city/network, write **a single generic connector** capable of reading any GTFS-RT feed referenced in the transport.data.gouv.fr catalog. This covers hundreds of French bus/metro/tram networks at once, with a single piece of code to maintain.

**Performance/budget caution**: the number of feeds to poll can grow large quickly (potentially hundreds). Prioritize the biggest cities at launch (Paris/IDFM, Lyon, Marseille, Toulouse, Bordeaux, Nantes, Lille...), and parallelize intelligently on the backend (queue + per-feed cache with its own TTL).

### 3.2 Satellites — SGP4 computation, not a simple fetch
CelesTrak does **not** provide a direct GPS position but **TLEs** (Two-Line Elements — orbital parameters). The active catalog holds around 15,000 objects, with TLEs updated roughly every 2 hours.

Processing flow:
1. The backend fetches TLEs periodically (every 2–6 hours is enough, small file)
2. The actual position is computed via the **SGP4** algorithm
3. **Do this computation client-side** (JS `satellite.js` library), not on the backend — the backend just forwards the raw TLEs, and each client computes and animates the position continuously and locally. This avoids unnecessary server-side compute load and gives smooth animation without constant network polling.

**Filtering required**: never display all ~15,000 objects at once (unreadable + heavy rendering). Plan for a filter by group (ISS, Starlink, GPS, weather satellites...).

### 3.3 Road traffic — different nature from the other feeds
Bison Futé provides a **segment state** (smooth/heavy/congested, average speeds), not individually tracked vehicles. On the map, this should translate into a **colored overlay on road segments** (green/orange/red), toggled independently from the other layers — don't try to fit it into the same data model as the "mobile objects."

### 3.4 Carbon footprint — methodological rigor
CO2 comparisons are sensitive to methodology (whether or not aircraft contrail / radiative forcing is included, real vs. average occupancy rate, well-to-wheel vs. combustion only...). Recommendations:
- Always **cite the source** (ADEME / Impact CO2) and methodology on the site
- Avoid oversimplified comparisons without stating assumptions (distance, occupancy rate)
- Stay factual, not preachy — this is what gives this kind of tool credibility (Impact CO2 is in fact cited by climate journalists for this reason)

### 3.5 OpenSky — recent authentication change
Since March 2026, OpenSky requires **OAuth2 authentication** (no more simple user/password from earlier versions of their API). Double-check their current docs at implementation time, as this point is evolving.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│                 FRONTEND (static)                     │
│   MapLibre GL JS + OSM/CARTO basemap                  │
│   "Mobile objects" layer (planes, boats, trains,      │
│      buses/metro/bike-share) — fed via backend polling│
│   "Satellites" layer — TLEs forwarded, position        │
│      continuously recomputed client-side via           │
│      satellite.js                                       │
│   "Road traffic" layer — colored overlay on segments,  │
│      independent toggle                                 │
│   "CO2" layer — per-vehicle popups, cumulative          │
│      counter, multimodal comparator                     │
│   Hosting: Netlify / Vercel / Cloudflare Pages (free)  │
└───────────────────────┬───────────────────────────────┘
                         │ WebSocket / periodic fetch
┌───────────────────────▼───────────────────────────────┐
│              Lightweight BACKEND (proxy + cache)         │
│   Node.js (Express/Fastify) or Python (FastAPI)         │
│   Independent pollers per source, each with its own      │
│      cache TTL:                                           │
│      - OpenSky: ~10-15s                                   │
│      - AISstream: WebSocket, continuous push               │
│      - Generic GTFS-RT: ~30s per feed, parallel/queued     │
│      - CelesTrak: ~every 2-6h                               │
│      - Bison Futé: ~6 min                                    │
│      - Impact CO2: very long cache (fairly stable factors)  │
│   Unified API exposed to the frontend (normalized format  │
│      per feed type)                                        │
│   Hosting: Fly.io / Render free tier, or a VPS ~€3-5/month│
│      (e.g. Hetzner) if stability is needed                 │
└───────────────────────┬───────────────────────────────┘
                         │
     ┌───────────────────┼────────────────────┐
     ▼                    ▼                     ▼
 OpenSky API      AISstream.io (WS)      SNCF/GTFS-RT
 (planes)         (boats)                (trains, buses...)
```

### Why a backend proxy (rather than calling APIs directly from the browser)?
- Keeps credentials safe (OAuth2 secrets, API keys)
- Avoids burning through the quota if several visitors are online at once — a single server-side poller, with all visitors sharing the same cache
- Allows merging/normalizing data formats (each source has its own format)

---

## 5. Proposed tech stack

| Component | Choice | Rationale |
|---|---|---|
| Map | **MapLibre GL JS** | Open-source, native WebGL, performant, no dependency on a paid API key (unlike Mapbox) |
| Basemap | CARTO dark tiles (`basemaps.cartocdn.com`) or OSM | Free |
| Backend | **Node.js + Express** or **Python + FastAPI** | Either works for this kind of proxy/aggregator — see the note below for a recommendation |
| Cache | In-memory object at first, **Redis** if traffic grows | Not needed while traffic stays low |
| Frontend hosting | **Cloudflare Pages** or **Netlify** | Free |
| Backend hosting | **Fly.io** (free tier) or a **Hetzner** VPS (~€3-5/month) | Free tier is enough at launch |
| Satellite computation | **satellite.js** (npm) | SGP4 implementation in JS, runs client-side |
| Domain name | ~€10-15/year | The only near-unavoidable cost item |

**Backend language note**: this hasn't been firmly decided yet. **Node.js + Express (or Fastify)** is the recommended default for this specific use case, for three reasons:
- The AISstream WebSocket poller, concurrent calls to potentially dozens/hundreds of GTFS-RT feeds, and the SGP4 computation (if ever also needed server-side) are all naturally asynchronous workloads — Node handles concurrent I/O very well without excessive complexity
- Same language as the frontend (JS/TS) — simpler to maintain solo, no mental context-switching
- The npm ecosystem already has ready-made GTFS-RT libraries and protobuf parsers (GTFS-RT is a protobuf format)

Python + FastAPI would make more sense if heavier server-side data processing is planned later (statistical analysis of emissions, complex aggregations, future machine learning on traffic patterns) — Python is stronger there, but for a simple real-time feed aggregator it's somewhat overkill.

---

## 6. 3D globe mode — optional, phase 2

A 3D "globe" rendering was considered using **Three.js**, particularly for visualizing satellites (real altitude, orbital inclination — far more readable in 3D than in 2D).

### Decision made
- **Phase 1 (MVP)**: stay in 2D with MapLibre GL. Faster to build, more practical for daily use in France (precise zoom, clicking on objects, street-level readability) — and above all, it keeps effort focused on the real core of the project: data feeds and the CO2 calculation.
- **Phase 2 (once the MVP is stable)**: add an **optional "globe" mode** alongside the default 2D map, using the **globe.gl** library (a high-level wrapper over Three.js/`three-globe`) to prototype quickly.

### Technical caveats on 3D
- `globe.gl` (the wrapper) is simpler to use but **less performant** than `three-globe` (the base library), especially when zoomed in with many points — a documented FPS drop exists on this point (a GitHub issue open since 2021 and never resolved, but the underlying principle still holds: the wrapper trades some performance for simplicity).
- If performance becomes a real issue once actual data volume is known, migrate to `three-globe` directly (less abstraction, more control).
- For simultaneously displaying thousands of objects (planes + boats + buses + satellites), plan ahead for:
  - **Culling**: only render what's within the camera's field of view or above a zoom threshold
  - **LOD (Level of Detail)**: cluster nearby points at low zoom, full detail only when zoomed in
- The 3D globe is visually striking at a worldwide scale (homepage, "exploration" mode) but **impractical for precise local use** — hence the choice to keep it as an alternate mode rather than the default view.

---

## 7. Planned CO2 features (by level of ambition)

### Level 1 — Simple (MVP)
- On clicking a vehicle: show its **CO2/km/passenger** (fixed factor per mode, via the Impact CO2 API)
- If the trip distance is known (origin → destination, via GTFS for trains/buses, flight plan for OpenSky): **estimated total trip CO2**
- A relatable visual comparison (e.g. "this flight = X kg CO2 = Y meals with meat")

### Level 2 — Differentiating
- **A→B trip selector**: compare CO2 emitted by each available mode for the same trip (plane vs. train vs. car vs. bus)
- **Color coding by mode** based on carbon intensity (green = train/bus, orange = car, red = short-haul flight)
- **Live cumulative counter**: CO2 emitted by all vehicles currently visible on the map, continuously recalculated

### Level 3 — Educational/advocacy (more advanced, worth considering after the rest is validated)
- Highlight **short flights that have a direct train alternative** (a few hours or less)
- **Simulation mode**: a slider — "what if X% of short-haul flights shifted to rail, how much CO2 would be saved?"
- Ranking/dashboard of the most/least emitting trips or airlines per passenger-km — factual and sourced, not preachy

---

## 8. Status to date

### Done
- Project brief and architecture validated (this document)
- Data sources decided
- Tech stack decided (MapLibre GL, Node/Python backend, free hosting)
- **A working standalone HTML prototype** was built to validate the visual rendering:
  - France map in dark theme (MapLibre GL + CARTO dark basemap)
  - 4 toggleable layers with counters (planes, trains, boats, buses) — **simulated data**, no real feeds yet
  - Simulated vehicles continuously moving between major French cities
  - Click popup: trip, distance, estimated passengers, **CO2 calculation with hardcoded ADEME factors** (to be replaced with a real call to the Impact CO2 API)
  - "Equivalent in meals with meat" comparator
  - Live cumulative emissions counter, reactive to active layers
  - Visual identity defined: dark-navy background `#0A0E14`, cyan accent `#3ED9C4` (movement/tracking), warm accent `#F2A65A` reserved for CO2 alerts, `Space Grotesk` typeface (headings/numbers) + `Inter` (body text)

The full prototype code is provided as an appendix to this document (section 10).

### Not done yet (suggested next steps, in logical order)
1. **Backend**: set up the proxy/aggregator server (Node or Python), starting with **OpenSky** (planes) as the simplest source to connect
2. Connect **AISstream** (boats) and the **generic GTFS-RT connector** (buses/metro/trains)
3. Replace the hardcoded CO2 factors with a real call to the **Impact CO2 API**
4. Add **real per-trip distance** calculation (the missing piece for an accurate per-trip CO2 figure rather than a generic factor/km) — to investigate based on data available per source (OpenSky flight plans, GTFS stops...)
5. Deployment (frontend on Cloudflare Pages/Netlify, backend on Fly.io or a VPS)
6. Satellites (CelesTrak + satellite.js) and road traffic (Bison Futé) — can come after a stable MVP covering the 4 main transport modes
7. 3D/globe mode (phase 2, optional)

### Not yet decided
- **Site name**: candidates discussed (TrafficLive.fr, FluxLive.fr, LiveGeo.fr...) but nothing settled — worth revisiting now that the CO2 angle is central; a name evoking both movement AND impact would be stronger. The prototype uses "Aire·Live" as a placeholder.

---

## 9. Budget summary

| Item | Estimated cost |
|---|---|
| Frontend hosting | €0 |
| Backend hosting | €0 (free tier) to €5/month (VPS if stability is needed) |
| Domain name | ~€10-15/year |
| OpenSky (planes) | €0 (quota-limited) to ~€30 one-time (ADS-B dongle for more quota) |
| AISstream (boats) | €0 |
| SNCF/GTFS-RT (trains, buses) | €0 |
| CelesTrak (satellites) | €0 |
| Bison Futé (road traffic) | €0 |
| Impact CO2 API (ADEME) | €0 |
| **Total, year 1** | **~€15-50** |
| **Total, following years** | **~€15/year** |

**Risk of budget overrun**: moving to worldwide usage with high traffic — free quotas (OpenSky, AISstream) would no longer be enough, requiring a switch to commercial APIs (hundreds of €/month). Not relevant for a France/Europe MVP with moderate traffic.

---

## 10. Appendix — Prototype code (reference for Cursor)

The attached `index.html` file is a standalone prototype (a single HTML page, inline CSS and JS, no build dependencies) demonstrating:
- MapLibre GL integration with a custom dark style
- The toggleable layer structure by vehicle type
- The simulated data model (to be replaced with real API feeds)
- The CO2 calculation and display logic (popups + cumulative counter)
- The project's visual identity (color/type tokens to reuse going forward)

**Goal for Cursor**: reuse this visual base and layer structure, then:
1. Replace the simulated data generator (`makeVehicle`, `tick()`) with real calls to the backend to be built
2. Build the backend described in section 4, starting with the OpenSky connector
3. Replace the hardcoded `CO2_FACTORS` with a call to the Impact CO2 API
