import './style.css'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { connectVehiclesWs, fetchCo2Factors, fetchRoadTraffic, fetchTleGroup } from './api'
import { applyVehicleColorTokens } from './colors'
import { co2PerHourKg, co2TripPerPassengerKg, co2ViewportIntensity } from './co2'
import { initFranceZone, inFranceZone } from './franceZone'
import { buildSatrecs, propagateAllAsync, type CachedSatrec } from './satellites'
import { registerVehicleIcons, SATELLITE_ICON_IMAGE, VEHICLE_ICON_IMAGE } from './vehicleIcons'
import { trainDisplayState, trainInFrance, trainsNeedMotionAnimation } from './trainMotion'
import {
  ALL_TYPES,
  LAYER_COLORS,
  LAYER_STACK_ORDER,
  SATELLITE_COLOR,
  SAT_GROUP_LABEL,
  SATELLITE_GROUPS,
  TYPE_LABEL,
  type Co2Factors,
  type RoadStatus,
  type Satellite,
  type SatelliteGroup,
  type Vehicle,
  type VehicleType,
} from './types'

applyVehicleColorTokens()

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div id="map"></div>
  <div class="header">
    <div class="brand">
      <div class="brand-mark">breathe<span>.</span>live</div>
      <div class="brand-tag">live traffic &amp; carbon footprint</div>
    </div>
    <div class="co2-panel" id="co2-panel">
      <div class="co2-label">Cumulative emissions — objects in view</div>
      <div class="co2-value"><span id="co2-total">0</span><span class="unit">kg CO₂e / h</span></div>
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
      <span class="layer-dot" style="background: ${SATELLITE_COLOR}"></span>
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
  <div class="live-pill">
    <span class="live-dot off" id="live-dot"></span>
    <span id="obj-count">connecting…</span>
  </div>
  <div class="map-footer">
    <div class="zoom-panel">
      <button type="button" class="zoom-btn" id="zoom-in" aria-label="Zoom in">+</button>
      <button type="button" class="zoom-btn" id="zoom-out" aria-label="Zoom out">−</button>
    </div>
    <div class="source-note" id="source-note"></div>
  </div>
`

const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'

function layerTitle(t: VehicleType): string {
  switch (t) {
    case 'plane':
      return 'Planes'
    case 'train':
      return 'Trains'
    case 'boat':
      return 'Boats'
    case 'bus':
      return 'Buses'
    case 'metro':
      return 'Metro'
  }
}

const STACK_SORT_BASE: Record<VehicleType, number> = {
  boat: 100,
  metro: 200,
  bus: 400,
  train: 410,
  plane: 500,
}

function vehicleSortKey(v: Vehicle): number {
  if (v.type === 'plane' && v.altitudeM != null) return STACK_SORT_BASE.plane + v.altitudeM
  return STACK_SORT_BASE[v.type]
}

function usesDenseDotLayer(type: VehicleType): boolean {
  return type === 'bus' || type === 'metro'
}

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark',
  center: [2.5, 46.8],
  zoom: 5.4,
  attributionControl: false,
})

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
let viewportRefreshTimer: ReturnType<typeof setTimeout> | undefined
let trainAnimRaf = 0
let lastTrainFrameMs = 0
const TRAIN_FRAME_MS = 1000 / 30

function inPaddedView(lon: number, lat: number): boolean {
  if (!layersReady) return true
  const bounds = map.getBounds()
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  const padLat = (ne.lat - sw.lat) * 0.12 + 0.05
  const padLon = (ne.lng - sw.lng) * 0.12 + 0.05
  return (
    lon >= sw.lng - padLon &&
    lon <= ne.lng + padLon &&
    lat >= sw.lat - padLat &&
    lat <= ne.lat + padLat
  )
}

function vehicleMapPoint(v: Vehicle): { lon: number; lat: number; heading: number } {
  if (v.type === 'train') return trainDisplayState(v, Date.now())
  return { lon: v.lon, lat: v.lat, heading: v.heading ?? 0 }
}

function trainVisibleInViewport(v: Vehicle): boolean {
  const pt = trainDisplayState(v, Date.now())
  if (inPaddedView(pt.lon, pt.lat)) return true
  if (!v.motion) return inPaddedView(v.lon, v.lat)
  if (inPaddedView(v.motion.fromLon, v.motion.fromLat)) return true
  if (inPaddedView(v.motion.toLon, v.motion.toLat)) return true
  const midLon = (v.motion.fromLon + v.motion.toLon) / 2
  const midLat = (v.motion.fromLat + v.motion.toLat) / 2
  return inPaddedView(midLon, midLat)
}

function vehicleInViewport(v: Vehicle, type: VehicleType): boolean {
  if (type === 'train') return trainVisibleInViewport(v)
  return inPaddedView(v.lon, v.lat)
}

function vehicleInFrance(v: Vehicle, type: VehicleType): boolean {
  if (type === 'train') return trainInFrance(v, inFranceZone)
  return inFranceZone(v.lon, v.lat)
}

function geojsonFor(type: VehicleType): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles
      .filter((v) => {
        if (v.type !== type || !vehicleInFrance(v, type)) return false
        return vehicleInViewport(v, type)
      })
      .map((v) => {
        const pt = vehicleMapPoint(v)
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] },
          properties: {
            id: v.id,
            type: v.type,
            heading: pt.heading,
            sortKey: vehicleSortKey(v),
          },
        }
      }),
  }
}

function satGeojson(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: satellites
      .filter((s) => inPaddedView(s.lon, s.lat))
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
        id: s.id,
        name: s.name,
        group: s.group,
        altitudeKm: s.altitudeKm,
        sortKey: 600 + s.altitudeKm,
      },
      })),
  }
}

function buildPopupHTML(v: Vehicle): string {
  const factor = v.type === 'metro' ? factors.bus : factors[v.type]
  const tripPax = co2TripPerPassengerKg(v, factors)
  const rows: string[] = []
  if (v.from || v.to) {
    rows.push(
      `<div class="pop-row"><span class="k">Trip</span><span class="v">${v.from ?? '—'} → ${v.to ?? '—'}</span></div>`,
    )
  }
  if (v.type === 'train' && v.motion) {
    rows.push(
      `<div class="pop-row"><span class="k">Position</span><span class="v">Interpolated along line (GTFS-RT)</span></div>`,
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
        <div class="pop-type" style="color: ${LAYER_COLORS[v.type]}">${TYPE_LABEL[v.type]}</div>
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

function roadStatusLabel(status: RoadStatus): string {
  switch (status) {
    case 'fluid':
      return 'Fluid band (≥ 70 km/h)'
    case 'heavy':
      return 'Moderate band (40–69 km/h)'
    case 'congested':
      return 'Slow band (&lt; 40 km/h)'
  }
}

function buildRoadPopup(props: {
  status?: RoadStatus
  speedKmh?: number
  label?: string
  statusDetail?: string
}): string {
  const status = (props.status ?? 'heavy') as RoadStatus
  const detail =
    props.statusDetail ??
    (props.speedKmh != null
      ? `Measured ${Math.round(props.speedKmh)} km/h.`
      : 'No speed reading in feed.')
  const axis = props.label ? escapeHtml(props.label) : 'Road segment'
  return `
    <div class="pop">
      <div class="pop-head">
        <div class="pop-type">Road traffic · Bison Futé</div>
        <div class="pop-title">${axis}</div>
      </div>
      <div class="pop-body">
        <div class="pop-row"><span class="k">Color band</span><span class="v">${roadStatusLabel(status)}</span></div>
        <div class="pop-row"><span class="k">Detail</span><span class="v">${escapeHtml(detail)}</span></div>
        <div class="pop-co2">
          <div class="pop-co2-compare">Segment geometry is a straight chord between counting stations, not the exact carriageway.</div>
        </div>
      </div>
    </div>
  `
}

function buildSatPopup(s: Satellite): string {
  return `
    <div class="pop">
      <div class="pop-head">
        <div class="pop-type" style="color: ${SATELLITE_COLOR}">Satellite · ${escapeHtml(SAT_GROUP_LABEL[s.group])}</div>
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
  if (map.getLayer(`${type}-halo`)) map.setLayoutProperty(`${type}-halo`, 'visibility', v)
  if (map.getLayer(`${type}-icon`)) map.setLayoutProperty(`${type}-icon`, 'visibility', v)
  if (usesDenseDotLayer(type) && map.getLayer(`${type}-dot`)) {
    map.setLayoutProperty(`${type}-dot`, 'visibility', v)
  }
  if (type === 'train') {
    if (visible) scheduleTrainMotionLoop()
    else stopTrainMotionLoop()
  }
}

function setSatVisibility(visible: boolean): void {
  const v = visible ? 'visible' : 'none'
  if (map.getLayer('satellite-icon')) map.setLayoutProperty('satellite-icon', 'visibility', v)
  if (map.getLayer('satellite-halo')) map.setLayoutProperty('satellite-halo', 'visibility', v)
}

function setRoadVisibility(visible: boolean): void {
  const v = visible ? 'visible' : 'none'
  if (map.getLayer('road-halo')) map.setLayoutProperty('road-halo', 'visibility', v)
  if (map.getLayer('road-lines')) map.setLayoutProperty('road-lines', 'visibility', v)
}

function refreshSources(skipAnimatedTrains = false): void {
  if (!layersReady) return
  for (const type of LAYER_STACK_ORDER) {
    if (skipAnimatedTrains && type === 'train' && trainsNeedMotionAnimation(vehicles)) continue
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
    const animatingTrains = trainsNeedMotionAnimation(vehicles)
    refreshSources(animatingTrains)
    if (animatingTrains) refreshTrainSource()
    scheduleStats()
    scheduleTrainMotionLoop()
  })
}

function refreshTrainSource(): void {
  if (!layersReady) return
  const src = map.getSource('train') as maplibregl.GeoJSONSource | undefined
  src?.setData(geojsonFor('train'))
}

function scheduleTrainMotionLoop(): void {
  if (trainAnimRaf) return
  if (!trainsNeedMotionAnimation(vehicles) || !layersReady || !activeLayers.has('train')) return

  const frame = (now: number) => {
    if (!trainsNeedMotionAnimation(vehicles) || !layersReady || !activeLayers.has('train')) {
      trainAnimRaf = 0
      return
    }
    if (now - lastTrainFrameMs >= TRAIN_FRAME_MS) {
      lastTrainFrameMs = now
      refreshTrainSource()
    }
    trainAnimRaf = requestAnimationFrame(frame)
  }
  trainAnimRaf = requestAnimationFrame(frame)
}

function stopTrainMotionLoop(): void {
  if (trainAnimRaf) {
    cancelAnimationFrame(trainAnimRaf)
    trainAnimRaf = 0
  }
}

function scheduleViewportRefresh(): void {
  if (viewportRefreshTimer !== undefined) clearTimeout(viewportRefreshTimer)
  viewportRefreshTimer = setTimeout(() => {
    viewportRefreshTimer = undefined
    refreshSources(trainsNeedMotionAnimation(vehicles))
    if (trainsNeedMotionAnimation(vehicles)) refreshTrainSource()
    refreshSatellites()
  }, 160)
}

function bindVehicleMapEvents(type: VehicleType): void {
  const onClick = (e: maplibregl.MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.id as string | undefined
    const v = vehicles.find((veh) => veh.id === id && veh.type === type)
    if (!v) return
    popup?.remove()
    const pt = vehicleMapPoint(v)
    popup = new maplibregl.Popup({ offset: 12, closeButton: true })
      .setLngLat([pt.lon, pt.lat])
      .setHTML(buildPopupHTML(v))
      .addTo(map)
  }
  const onEnter = () => {
    map.getCanvas().style.cursor = 'pointer'
  }
  const onLeave = () => {
    map.getCanvas().style.cursor = ''
  }
  const layerIds = usesDenseDotLayer(type) ? [`${type}-icon`, `${type}-dot`] : [`${type}-icon`]
  for (const layerId of layerIds) {
    map.on('click', layerId, onClick)
    map.on('mouseenter', layerId, onEnter)
    map.on('mouseleave', layerId, onLeave)
  }
}

function updateSourceNote(): void {
  const note = document.getElementById('source-note')
  if (!note) return
  const extras: string[] = []
  if (satellitesOn) extras.push('orbits: <strong>CelesTrak</strong> TLE + SGP4')
  if (roadOn) {
    extras.push('roads: <strong>Bison Futé</strong> (green ≥70 · orange 40–69 · red &lt;40 km/h, measured speed)')
  }
  note.innerHTML = `Map: ${MAP_ATTRIBUTION}<br>Emission factors: <strong>${escapeHtml(factorSource)}</strong>${
    extras.length ? `<br>${extras.join(' · ')}` : ''
  }`
}

function updateStats(): void {
  const counts: Record<VehicleType, number> = { plane: 0, train: 0, boat: 0, bus: 0, metro: 0 }
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
  updateCo2PanelVisual(co2Total)
}

let co2PanelAlert = false

function updateCo2PanelVisual(kgPerHour: number): void {
  const panel = document.getElementById('co2-panel')
  if (!panel) return
  const intensity = co2ViewportIntensity(kgPerHour)
  panel.style.setProperty('--co2-intensity', intensity.toFixed(3))
  const alert = intensity >= 0.72
  if (alert !== co2PanelAlert) {
    co2PanelAlert = alert
    panel.classList.toggle('co2-panel--alert', alert)
  }
  panel.classList.toggle('co2-panel--active', kgPerHour > 0)
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

function addVehicleTypeLayers(type: VehicleType): void {
  map.addSource(type, { type: 'geojson', data: geojsonFor(type), promoteId: 'id' })
  map.addLayer({
    id: `${type}-halo`,
    type: 'circle',
    source: type,
    maxzoom: 9,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 11, 8, 7],
      'circle-color': LAYER_COLORS[type],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.18, 8.5, 0],
    },
  })
  if (usesDenseDotLayer(type)) {
    map.addLayer({
      id: `${type}-dot`,
      type: 'circle',
      source: type,
      maxzoom: 10,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.8, 9, 3.6],
        'circle-color': LAYER_COLORS[type],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#0a0e14',
      },
    })
  }
  map.addLayer({
    id: `${type}-icon`,
    type: 'symbol',
    source: type,
    minzoom: usesDenseDotLayer(type) ? 10 : 5,
    layout: {
      'icon-image': VEHICLE_ICON_IMAGE[type],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.36, 8, 0.5, 12, 0.68],
      'icon-rotate': ['coalesce', ['get', 'heading'], 0],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': type === 'plane' || type === 'boat' || type === 'train',
      'icon-ignore-placement': type === 'plane' || type === 'boat' || type === 'train',
      'symbol-sort-key': ['get', 'sortKey'],
    },
  })
  bindVehicleMapEvents(type)
}

function addRoadMapLayers(): void {
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
  const onRoadClick = (e: maplibregl.MapLayerMouseEvent) => {
    const p = e.features?.[0]?.properties as {
      status?: RoadStatus
      speedKmh?: number
      label?: string
      statusDetail?: string
    }
    if (!p || !e.lngLat) return
    popup?.remove()
    popup = new maplibregl.Popup({ offset: 12, closeButton: true })
      .setLngLat(e.lngLat)
      .setHTML(buildRoadPopup(p))
      .addTo(map)
  }
  const onRoadEnter = () => {
    map.getCanvas().style.cursor = 'pointer'
  }
  const onRoadLeave = () => {
    map.getCanvas().style.cursor = ''
  }
  for (const layerId of ['road-lines', 'road-halo']) {
    map.on('click', layerId, onRoadClick)
    map.on('mouseenter', layerId, onRoadEnter)
    map.on('mouseleave', layerId, onRoadLeave)
  }
}

function addSatelliteLayers(): void {
  map.addSource('satellite', { type: 'geojson', data: satGeojson() })
  map.addLayer({
    id: 'satellite-halo',
    type: 'circle',
    source: 'satellite',
    maxzoom: 9,
    paint: {
      'circle-radius': 12,
      'circle-color': SATELLITE_COLOR,
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.22, 8.5, 0],
    },
  })
  map.addLayer({
    id: 'satellite-icon',
    type: 'symbol',
    source: 'satellite',
    minzoom: 5,
    layout: {
      'icon-image': SATELLITE_ICON_IMAGE,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.38, 9, 0.52, 12, 0.64],
      'icon-allow-overlap': false,
      'icon-ignore-placement': false,
      'symbol-sort-key': ['get', 'sortKey'],
    },
  })
  map.on('click', 'satellite-icon', (e) => {
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
  map.on('mouseenter', 'satellite-icon', () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'satellite-icon', () => {
    map.getCanvas().style.cursor = ''
  })
}

async function initMapLayers(): Promise<void> {
  await registerVehicleIcons(map)

  for (const type of LAYER_STACK_ORDER) {
    addVehicleTypeLayers(type)
    if (type === 'metro') addRoadMapLayers()
  }

  addSatelliteLayers()

  layersReady = true
  setRoadVisibility(roadOn)
  void franceZoneReady.then(() => {
    const animatingTrains = trainsNeedMotionAnimation(vehicles)
    refreshSources(animatingTrains)
    if (animatingTrains) refreshTrainSource()
    scheduleStats()
    updateSourceNote()
    scheduleTrainMotionLoop()
    requestAnimationFrame(() => void syncSatrecs())
    if (roadOn) void loadRoads()
  })
}

map.on('load', () => {
  void initMapLayers()
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

document.getElementById('zoom-in')?.addEventListener('click', () => map.zoomIn())
document.getElementById('zoom-out')?.addEventListener('click', () => map.zoomOut())

updateSourceNote()

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

function onMapViewChange(): void {
  scheduleStatsDebounced()
  scheduleViewportRefresh()
}

map.on('moveend', onMapViewChange)
map.on('zoomend', onMapViewChange)
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
