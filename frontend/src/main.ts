import './style.css'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { connectVehiclesWs, fetchCo2Factors } from './api'
import { co2PerHourKg, co2TripPerPassengerKg } from './co2'
import {
  ALL_TYPES,
  LAYER_COLORS,
  TYPE_LABEL,
  type Co2Factors,
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
let factors: Co2Factors = {
  plane: 230,
  train: 3,
  boat: 15,
  bus: 68,
  source: 'Fallback',
  updatedAt: new Date().toISOString(),
}
const activeLayers = new Set<VehicleType>(ALL_TYPES)
let popup: maplibregl.Popup | null = null
let layersReady = false

function geojsonFor(type: VehicleType): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles
      .filter((v) => v.type === type)
      .map((v) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
        properties: { id: v.id, type: v.type },
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

  const co2Value =
    tripPax != null ? `${tripPax.toFixed(1)} kg` : `${factor} g/pax·km`
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function setLayerVisibility(type: VehicleType, visible: boolean): void {
  const v = visible ? 'visible' : 'none'
  if (map.getLayer(`${type}-point`)) map.setLayoutProperty(`${type}-point`, 'visibility', v)
  if (map.getLayer(`${type}-halo`)) map.setLayoutProperty(`${type}-halo`, 'visibility', v)
}

function refreshSources(): void {
  if (!layersReady) return
  for (const type of ALL_TYPES) {
    const src = map.getSource(type) as maplibregl.GeoJSONSource | undefined
    src?.setData(geojsonFor(type))
  }
}

function inMapView(v: Vehicle): boolean {
  // Do not use map.loaded() — it flips false while GeoJSON sources update,
  // which made the CO₂ total flicker to 0 on every feed refresh.
  if (!layersReady) return false
  const lon = Number(v.lon)
  const lat = Number(v.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
  return map.getBounds().contains([lon, lat])
}

function updateStats(): void {
  const counts: Record<VehicleType, number> = { plane: 0, train: 0, boat: 0, bus: 0 }
  for (const v of vehicles) counts[v.type]++
  for (const type of ALL_TYPES) {
    const el = document.getElementById(`count-${type}`)
    if (el) el.textContent = String(counts[type])
  }

  // CO₂ + header count: active layers AND inside current map viewport
  const inView = vehicles.filter((v) => activeLayers.has(v.type) && inMapView(v))
  const obj = document.getElementById('obj-count')
  if (obj) obj.textContent = `${inView.length.toLocaleString('en-US')} objects in view`

  const total = inView.reduce((sum, v) => sum + co2PerHourKg(v, factors), 0)
  const totalEl = document.getElementById('co2-total')
  if (totalEl) totalEl.textContent = Math.round(total).toLocaleString('en-US')
}

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
  layersReady = true
  refreshSources()
  updateStats()
})

document.querySelectorAll('.layer-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = (btn as HTMLElement).dataset.layer as VehicleType
    if (activeLayers.has(type)) {
      activeLayers.delete(type)
      btn.classList.remove('active')
      setLayerVisibility(type, false)
    } else {
      activeLayers.add(type)
      btn.classList.add('active')
      setLayerVisibility(type, true)
    }
    updateStats()
  })
})

const liveDot = document.getElementById('live-dot')!

connectVehiclesWs((next) => {
  vehicles = next
  liveDot.classList.remove('off')
  refreshSources()
  updateStats()
})

void fetchCo2Factors()
  .then((f) => {
    factors = f
    const note = document.getElementById('source-note')
    if (note) {
      note.innerHTML = `Emission factors: <strong>${escapeHtml(f.source)}</strong>`
    }
    updateStats()
  })
  .catch(() => {
    /* keep fallback */
  })

map.on('moveend', updateStats)
map.on('zoomend', updateStats)
setInterval(updateStats, 3000)
