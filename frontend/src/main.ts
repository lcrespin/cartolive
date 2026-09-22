import './style.css'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { connectVehiclesWs, fetchCo2Factors, fetchRoadTraffic, fetchTleGroup } from './api'
import { co2PerHourKg, co2TripPerPassengerKg } from './co2'
import { initFranceZone, inFranceZone } from './franceZone'
import { buildSatrecs, propagateAllAsync, type CachedSatrec } from './satellites'
import {
  ALL_TYPES,
  LAYER_COLORS,
  SAT_GROUP_LABEL,
  SATELLITE_GROUPS,
  TYPE_LABEL,
  type Co2Factors,
  type Satellite,
  type SatelliteGroup,
  type Vehicle,
  type VehicleType,
} from './types'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div id="map"></div>
  <div class="header">
    <div class="brand">
      <div class="brand-mark">breathe<span>.</span>live</div>
      <div class="brand-tag">live traffic &amp; carbon footprint</div>
    </div>
    <div class="live-pill">
      <span class="live-dot off" id="live-dot"></span>
      <span id="obj-count">connecting…</span>
    </div>
  </div>
  <div class="layers" id="layers">
    ${ALL_TYPES.map(
      (t) => `
      <div class="layer-btn active" data-layer="${t}">
        <span class="layer-dot" style="background: ${LAYER_COLORS[t]}"></span>
        ${layerTitle(t)}
        <span class="layer-count" id="count-${t}">0</span>
      </div>`,
    ).join('')}
    <div class="layer-btn active" data-layer="satellite" id="sat-layer-btn">
      <span class="layer-dot" style="background: var(--sat)"></span>
      Satellites
      <span class="layer-count" id="count-satellite">0</span>
    </div>
    <div class="sat-filters open" id="sat-filters">
      ${SATELLITE_GROUPS.map(
        (g) => `
        <span class="sat-chip active" data-sat-group="${g}">${SAT_GROUP_LABEL[g]}</span>`,
      ).join('')}
    </div>
    <div class="layer-btn active" data-layer="road" id="road-layer-btn">
      <span class="layer-dot" style="background: var(--road)"></span>
      Road traffic
      <span class="layer-count" id="count-road">0</span>
    </div>
  </div>
  <div class="co2-panel">
    <div class="co2-label">Cumulative emissions — objects in view</div>
    <div class="co2-value"><span id="co2-total">0</span><span class="unit">kg CO₂e / h</span></div>
  </div>
  <div class="source-note" id="source-note">
    Emission factors: <strong>Base Empreinte® ADEME</strong> via Impact CO2.
  </div>
`

function layerTitle(t: VehicleType): string {
  switch (t) {
    case 'plane':
      return 'Planes'
    case 'train':
      return 'Trains'
    case 'boat':
      return 'Boats'
    case 'bus':
      return 'Buses & metro'
  }
}

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark',
  center: [2.5, 46.8],
  zoom: 5.4,
  attributionControl: { compact: true },
})

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

let vehicles: Vehicle[] = []
let satellites: Satellite[] = []
let satrecs: CachedSatrec[] = []
let factors: Co2Factors = {
  plane: 224.2,
  train: 2.3,
  boat: 18.7,
  bus: 113.5,
  source: 'Snapshot loading…',
  updatedAt: new Date().toISOString(),
}
const activeLayers = new Set<VehicleType>(ALL_TYPES)
let satellitesOn = true
const satGroups = new Set<SatelliteGroup>(SATELLITE_GROUPS)
let roadOn = true
let roadSegmentCount = 0
let popup: maplibregl.Popup | null = null
let layersReady = false
let factorSource = 'Base Empreinte® ADEME via Impact CO2'
let statsRaf = 0
let statsDebounceTimer: ReturnType<typeof setTimeout> | undefined
let satTickTimer: ReturnType<typeof setInterval> | undefined
let satTickGen = 0
let vehicleRefreshRaf = 0

function geojsonFor(type: VehicleType): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles
      .filter((v) => v.type === type && inFranceZone(v.lon, v.lat))
      .map((v) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
        properties: { id: v.id, type: v.type },
      })),
  }
}

function satGeojson(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: satellites.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id, name: s.name, group: s.group, altitudeKm: s.altitudeKm },
    })),
  }
}

function buildPopupHTML(v: Vehicle): string {
  const factor = factors[v.type]
  const tripPax = co2TripPerPassengerKg(v, factors)
  const rows: string[] = []
  if (v.from || v.to) {
    rows.push(
      `<div class="pop-row"><span class="k">Trip</span><span class="v">${v.from ?? '—'} → ${v.to ?? '—'}</span></div>`,
    )
  }
  if (v.distanceKm != null) {
    rows.push(
      `<div class="pop-row"><span class="k">Distance</span><span class="v">${Math.round(v.distanceKm)} km</span></div>`,
    )
  }
  if (v.speedKmh != null) {
    rows.push(
      `<div class="pop-row"><span class="k">Speed</span><span class="v">${Math.round(v.speedKmh)} km/h</span></div>`,
    )
  }
  if (v.passengers != null) {
    rows.push(
      `<div class="pop-row"><span class="k">Passengers (est.)</span><span class="v">${v.passengers}</span></div>`,
    )
  }

  const co2Value = tripPax != null ? `${tripPax.toFixed(1)} kg` : `${factor} g/pax·km`
  const co2Label = tripPax != null ? 'CO₂ / passenger' : 'CO₂ factor'
  const co2Detail =
    tripPax != null
      ? `Based on ${factor} gCO₂e / passenger·km (ADEME / Impact CO2).`
      : `Emission factor from ADEME / Impact CO2.`

  return `
    <div class="pop">
      <div class="pop-head">
        <div class="pop-type">${TYPE_LABEL[v.type]}</div>
        <div class="pop-title">${escapeHtml(v.label)}</div>
      </div>
      <div class="pop-body">
        ${rows.join('')}
        <div class="pop-co2">
          <div class="pop-co2-top">
            <span class="pop-co2-label">${co2Label}</span>
            <span class="pop-co2-value">${co2Value}</span>
          </div>
          <div class="pop-co2-compare">${co2Detail}</div>
        </div>
      </div>
    </div>
  `
}

function buildSatPopup(s: Satellite): string {
  return `
    <div class="pop">
      <div class="pop-head">
        <div class="pop-type">Satellite · ${escapeHtml(SAT_GROUP_LABEL[s.group])}</div>
        <div class="pop-title">${escapeHtml(s.name)}</div>
      </div>
      <div class="pop-body">
        <div class="pop-row"><span class="k">Altitude</span><span class="v">${Math.round(s.altitudeKm).toLocaleString('en-US')} km</span></div>
        <div class="pop-co2">
          <div class="pop-co2-compare">No ADEME / Impact CO2 factor for orbital objects.</div>
        </div>
      </div>
    </div>
  `
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function setLayerVisibility(type: VehicleType, visible: boolean): void {
  const v = visible ? 'visible' : 'none'
  if (map.getLayer(`${type}-point`)) map.setLayoutProperty(`${type}-point`, 'visibility', v)
  if (map.getLayer(`${type}-halo`)) map.setLayoutProperty(`${type}-halo`, 'visibility', v)
}

function setSatVisibility(visible: boolean): void {
  const v = visible ? 'visible' : 'none'
  if (map.getLayer('satellite-point')) map.setLayoutProperty('satellite-point', 'visibility', v)
  if (map.getLayer('satellite-halo')) map.setLayoutProperty('satellite-halo', 'visibility', v)
}

function setRoadVisibility(visible: boolean): void {
  const v = visible ? 'visible' : 'none'
  if (map.getLayer('road-halo')) map.setLayoutProperty('road-halo', 'visibility', v)
  if (map.getLayer('road-lines')) map.setLayoutProperty('road-lines', 'visibility', v)
}

function refreshSources(): void {
  if (!layersReady) return
  for (const type of ALL_TYPES) {
    const src = map.getSource(type) as maplibregl.GeoJSONSource | undefined
    src?.setData(geojsonFor(type))
  }
}

function refreshSatellites(): void {
  if (!layersReady) return
  const src = map.getSource('satellite') as maplibregl.GeoJSONSource | undefined
  src?.setData(satGeojson())
}

function scheduleStats(): void {
  if (statsRaf) return
  statsRaf = requestAnimationFrame(() => {
    statsRaf = 0
    updateStats()
  })
}

function scheduleStatsDebounced(): void {
  if (statsDebounceTimer !== undefined) clearTimeout(statsDebounceTimer)
  statsDebounceTimer = setTimeout(() => {
    statsDebounceTimer = undefined
    scheduleStats()
  }, 120)
}

function scheduleVehicleLayerRefresh(): void {
  if (vehicleRefreshRaf) return
  vehicleRefreshRaf = requestAnimationFrame(() => {
    vehicleRefreshRaf = 0
    refreshSources()
    scheduleStats()
  })
}

function updateSourceNote(): void {
  const note = document.getElementById('source-note')
  if (!note) return
  const extras: string[] = []
  if (satellitesOn) extras.push('orbits: <strong>CelesTrak</strong> TLE + SGP4')
  if (roadOn) extras.push('roads: <strong>Bison Futé</strong>')
  note.innerHTML = `Emission factors: <strong>${escapeHtml(factorSource)}</strong>${
    extras.length ? `<br>${extras.join(' · ')}` : ''
  }`
}

function updateStats(): void {
  const counts: Record<VehicleType, number> = { plane: 0, train: 0, boat: 0, bus: 0 }
  let inViewCount = 0
  let co2Total = 0
  const bounds = layersReady ? map.getBounds() : null

  for (const v of vehicles) {
    if (!inFranceZone(v.lon, v.lat)) continue
    counts[v.type]++
    if (!bounds || !activeLayers.has(v.type)) continue
    if (!bounds.contains([v.lon, v.lat])) continue
    inViewCount++
    co2Total += co2PerHourKg(v, factors)
  }

  for (const type of ALL_TYPES) {
    const el = document.getElementById(`count-${type}`)
    if (el) el.textContent = String(counts[type])
  }
  const satEl = document.getElementById('count-satellite')
  if (satEl) satEl.textContent = String(satellitesOn ? satellites.length : 0)
  const roadEl = document.getElementById('count-road')
  if (roadEl) roadEl.textContent = String(roadOn ? roadSegmentCount : 0)

  if (satellitesOn && bounds) {
    for (const s of satellites) {
      if (bounds.contains([s.lon, s.lat])) inViewCount++
    }
  }

  const obj = document.getElementById('obj-count')
  if (obj) obj.textContent = `${inViewCount.toLocaleString('en-US')} objects in view`

  const totalEl = document.getElementById('co2-total')
  if (totalEl) totalEl.textContent = Math.round(co2Total).toLocaleString('en-US')
}

function resetSatTickInterval(): void {
  if (satTickTimer !== undefined) clearInterval(satTickTimer)
  const ms = satrecs.length > 2500 ? 2500 : 1000
  satTickTimer = setInterval(() => void tickSats(), ms)
}

async function tickSats(): Promise<void> {
  if (!satellitesOn || satrecs.length === 0) {
    satellites = []
    refreshSatellites()
    scheduleStats()
    return
  }
  const gen = ++satTickGen
  const result = await propagateAllAsync(satrecs, { keep: inFranceZone })
  if (gen !== satTickGen) return
  satellites = result
  refreshSatellites()
  scheduleStats()
}

const tleCache = new Map<SatelliteGroup, CachedSatrec[]>()

async function loadSatGroup(group: SatelliteGroup): Promise<void> {
  const cached = tleCache.get(group)
  if (cached && cached.length > 0) return
  const chip = document.querySelector(`[data-sat-group="${group}"]`)
  chip?.classList.add('loading')
  try {
    const records = await fetchTleGroup(group)
    tleCache.set(group, buildSatrecs(group, records))
  } finally {
    chip?.classList.remove('loading')
  }
}

async function syncSatrecs(): Promise<void> {
  if (!satellitesOn) {
    satrecs = []
    void tickSats()
    return
  }
  const wanted = [...satGroups]
  await Promise.all(
    wanted.map(async (g) => {
      try {
        await loadSatGroup(g)
      } catch (err) {
        console.warn('TLE load failed', g, err)
      }
    }),
  )
  satrecs = wanted.flatMap((g) => tleCache.get(g) ?? [])
  resetSatTickInterval()
  void tickSats()
}

async function loadRoads(): Promise<void> {
  if (!layersReady) return
  try {
    const data = await fetchRoadTraffic()
    const features = data.features.filter((f) => {
      const coords = f.geometry.coordinates
      if (coords.length === 0) return false
      const mid =
        coords.length === 1
          ? coords[0]
          : [(coords[0][0] + coords[coords.length - 1][0]) / 2, (coords[0][1] + coords[coords.length - 1][1]) / 2]
      return inFranceZone(mid[0], mid[1])
    })
    roadSegmentCount = features.length
    const src = map.getSource('road') as maplibregl.GeoJSONSource | undefined
    src?.setData({
      type: 'FeatureCollection',
      features,
    })
    const el = document.getElementById('count-road')
    if (el) el.textContent = String(roadOn ? roadSegmentCount : 0)
  } catch (err) {
    console.warn('road traffic', err)
  }
}

const franceZoneReady = initFranceZone().catch((err) => {
  console.warn('France zone load failed', err)
})

map.on('load', () => {
  for (const type of ALL_TYPES) {
    map.addSource(type, { type: 'geojson', data: geojsonFor(type) })
    map.addLayer({
      id: `${type}-halo`,
      type: 'circle',
      source: type,
      paint: {
        'circle-radius': 10,
        'circle-color': LAYER_COLORS[type],
        'circle-opacity': 0.15,
      },
    })
    map.addLayer({
      id: `${type}-point`,
      type: 'circle',
      source: type,
      paint: {
        'circle-radius': type === 'bus' ? 4 : 5.5,
        'circle-color': LAYER_COLORS[type],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#0a0e14',
      },
    })

    map.on('click', `${type}-point`, (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined
      const v = vehicles.find((veh) => veh.id === id && veh.type === type)
      if (!v) return
      popup?.remove()
      popup = new maplibregl.Popup({ offset: 12, closeButton: true })
        .setLngLat([v.lon, v.lat])
        .setHTML(buildPopupHTML(v))
        .addTo(map)
    })
    map.on('mouseenter', `${type}-point`, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', `${type}-point`, () => {
      map.getCanvas().style.cursor = ''
    })
  }

  map.addSource('satellite', { type: 'geojson', data: satGeojson() })
  map.addLayer({
    id: 'satellite-halo',
    type: 'circle',
    source: 'satellite',
    paint: { 'circle-radius': 14, 'circle-color': '#d4e157', 'circle-opacity': 0.22 },
  })
  map.addLayer({
    id: 'satellite-point',
    type: 'circle',
    source: 'satellite',
    paint: {
      'circle-radius': 6.5,
      'circle-color': '#d4e157',
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#0a0e14',
    },
  })
  map.on('click', 'satellite-point', (e) => {
    const p = e.features?.[0]?.properties
    if (!p) return
    const s = satellites.find((sat) => sat.id === p.id)
    if (!s) return
    popup?.remove()
    popup = new maplibregl.Popup({ offset: 12, closeButton: true })
      .setLngLat([s.lon, s.lat])
      .setHTML(buildSatPopup(s))
      .addTo(map)
  })
  map.on('mouseenter', 'satellite-point', () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'satellite-point', () => {
    map.getCanvas().style.cursor = ''
  })

  map.addSource('road', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'road-halo',
    type: 'line',
    source: 'road',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 12, 7, 7, 11, 4],
      'line-color': '#0a0e14',
      'line-opacity': 0.55,
    },
  })
  map.addLayer({
    id: 'road-lines',
    type: 'line',
    source: 'road',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 7.5, 7, 4, 11, 2.4],
      'line-color': [
        'match',
        ['get', 'status'],
        'fluid',
        '#3ed9c4',
        'heavy',
        '#f2a65a',
        'congested',
        '#e85d4c',
        '#8b95a5',
      ],
      'line-opacity': 0.85,
    },
  })

  layersReady = true
  setRoadVisibility(roadOn)
  void franceZoneReady.then(() => {
    refreshSources()
    scheduleStats()
    updateSourceNote()
    requestAnimationFrame(() => void syncSatrecs())
    if (roadOn) void loadRoads()
  })
})

document.querySelectorAll('.layer-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const layer = (btn as HTMLElement).dataset.layer
    if (layer === 'satellite') {
      satellitesOn = !satellitesOn
      btn.classList.toggle('active', satellitesOn)
      document.getElementById('sat-filters')?.classList.toggle('open', satellitesOn)
      setSatVisibility(satellitesOn)
      requestAnimationFrame(() => void syncSatrecs())
      updateSourceNote()
      scheduleStats()
      return
    }
    if (layer === 'road') {
      roadOn = !roadOn
      btn.classList.toggle('active', roadOn)
      setRoadVisibility(roadOn)
      if (roadOn) void loadRoads()
      updateSourceNote()
      scheduleStats()
      return
    }
    const type = layer as VehicleType
    if (activeLayers.has(type)) {
      activeLayers.delete(type)
      btn.classList.remove('active')
      setLayerVisibility(type, false)
    } else {
      activeLayers.add(type)
      btn.classList.add('active')
      setLayerVisibility(type, true)
    }
    scheduleStats()
  })
})

document.querySelectorAll('.sat-chip').forEach((chip) => {
  chip.addEventListener('click', (ev) => {
    ev.stopPropagation()
    const group = (chip as HTMLElement).dataset.satGroup as SatelliteGroup
    if (satGroups.has(group)) {
      if (satGroups.size === 1) return
      satGroups.delete(group)
      chip.classList.remove('active')
    } else {
      satGroups.add(group)
      chip.classList.add('active')
    }
    requestAnimationFrame(() => void syncSatrecs())
  })
})

const liveDot = document.getElementById('live-dot')!

connectVehiclesWs((next) => {
  vehicles = next
  liveDot.classList.remove('off')
  void franceZoneReady.then(() => scheduleVehicleLayerRefresh())
})

void fetchCo2Factors()
  .then((f) => {
    factors = f
    factorSource = f.source
    updateSourceNote()
    scheduleStats()
  })
  .catch(() => {
    /* keep fallback */
  })

map.on('moveend', scheduleStatsDebounced)
map.on('zoomend', scheduleStatsDebounced)
resetSatTickInterval()
setInterval(() => {
  if (roadOn) void loadRoads()
}, 6 * 60_000)
function refreshTleCache(): void {
  tleCache.clear()
  if (satellitesOn) void syncSatrecs()
}

setInterval(refreshTleCache, 2 * 60 * 60_000)
window.addEventListener('focus', refreshTleCache)
