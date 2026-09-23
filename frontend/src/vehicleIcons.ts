import type maplibregl from 'maplibre-gl'
import { LAYER_COLORS, SATELLITE_COLOR, type VehicleType } from './types'

const MAP_BG = '#0a0e14'
const RASTER_SIZE = 64

const PLANE_PATH =
  'M16 1 C16.8 1 17.4 1.6 17.6 2.5 L19 11 L28.5 17 C29.3 17.5 29.8 18.3 29.8 19.2 L29.8 20.8 C29.8 21.4 29.3 21.7 28.7 21.5 L18.5 18.3 L17.6 24.5 L21 27.3 C21.5 27.7 21.7 28.2 21.7 28.8 L21.7 29.6 C21.7 30 21.3 30.3 20.9 30.1 L16 28.2 L11.1 30.1 C10.7 30.3 10.3 30 10.3 29.6 L10.3 28.8 C10.3 28.2 10.5 27.7 11 27.3 L14.4 24.5 L13.5 18.3 L3.3 21.5 C2.7 21.7 2.2 21.4 2.2 20.8 L2.2 19.2 C2.2 18.3 2.7 17.5 3.5 17 L13 11 L14.4 2.5 C14.6 1.6 15.2 1 16 1 Z'

const TRAIN_INNER = `
  <rect x="10.5" y="7.5" width="5" height="7" rx="1" fill="${MAP_BG}"/>
  <rect x="16.5" y="7.5" width="5" height="7" rx="1" fill="${MAP_BG}"/>
  <rect x="9" y="18" width="14" height="2.4" rx="1.2" fill="${MAP_BG}"/>
  <circle cx="11.5" cy="26" r="1.6" fill="${MAP_BG}"/>
  <circle cx="20.5" cy="26" r="1.6" fill="${MAP_BG}"/>
`

const BOAT_PATHS = `
  <path d="M16 2 C17 2 17.7 2.7 18 3.8 L20.5 14 L20.5 14 L16 14 L11.5 14 L14 3.8 C14.3 2.7 15 2 16 2 Z"/>
  <path d="M6 15 L26 15 C27 15 27.5 15.7 27.1 16.6 L23.5 25.5 C22.9 27 21.6 28 20 28 L12 28 C10.4 28 9.1 27 8.5 25.5 L4.9 16.6 C4.5 15.7 5 15 6 15 Z"/>
`

const BUS_INNER = `
  <rect x="9" y="7.5" width="4.2" height="5" rx="1" fill="${MAP_BG}"/>
  <rect x="13.9" y="7.5" width="4.2" height="5" rx="1" fill="${MAP_BG}"/>
  <rect x="18.8" y="7.5" width="4.2" height="5" rx="1" fill="${MAP_BG}"/>
  <rect x="9" y="15.5" width="14" height="7.5" rx="1.5" fill="${MAP_BG}"/>
  <circle cx="11" cy="27" r="1.7" fill="${MAP_BG}"/>
  <circle cx="21" cy="27" r="1.7" fill="${MAP_BG}"/>
`

const SAT_INNER = `
  <rect x="12.5" y="12.5" width="7" height="7" rx="1.5"/>
  <rect x="1" y="10.5" width="9" height="11" rx="1.2"/>
  <rect x="22" y="10.5" width="9" height="11" rx="1.2"/>
  <rect x="10" y="15" width="2.5" height="2"/>
  <rect x="19.5" y="15" width="2.5" height="2"/>
  <line x1="16" y1="12.5" x2="16" y2="6" stroke="${SATELLITE_COLOR}" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="16" cy="5" r="1.4"/>
`

export const VEHICLE_ICON_IMAGE: Record<VehicleType, string> = {
  plane: 'vehicle-plane',
  train: 'vehicle-train',
  boat: 'vehicle-boat',
  bus: 'vehicle-bus',
  metro: 'vehicle-metro',
}

export const SATELLITE_ICON_IMAGE = 'vehicle-satellite'

function wrapSvg(body: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="${color}">${body}</svg>`
}

function svgToImageData(svg: string, size: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas 2d'))
        return
      }
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      resolve(ctx.getImageData(0, 0, size, size))
    }
    img.onerror = () => reject(new Error('svg rasterize failed'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

async function addRasterIcon(map: maplibregl.Map, id: string, svg: string): Promise<void> {
  if (map.hasImage(id)) return
  const data = await svgToImageData(svg, RASTER_SIZE)
  map.addImage(id, data, { pixelRatio: 2 })
}

export async function registerVehicleIcons(map: maplibregl.Map): Promise<void> {
  const plane = wrapSvg(`<path d="${PLANE_PATH}"/>`, LAYER_COLORS.plane)
  const train = wrapSvg(`<rect x="7" y="3" width="18" height="26" rx="5"/>${TRAIN_INNER}`, LAYER_COLORS.train)
  const boat = wrapSvg(BOAT_PATHS, LAYER_COLORS.boat)
  const bus = wrapSvg(`<rect x="6" y="4" width="20" height="24" rx="4"/>${BUS_INNER}`, LAYER_COLORS.bus)
  const metro = wrapSvg(`<rect x="6" y="4" width="20" height="24" rx="4"/>${BUS_INNER}`, LAYER_COLORS.metro)
  const sat = wrapSvg(SAT_INNER, SATELLITE_COLOR)

  await Promise.all([
    addRasterIcon(map, VEHICLE_ICON_IMAGE.plane, plane),
    addRasterIcon(map, VEHICLE_ICON_IMAGE.train, train),
    addRasterIcon(map, VEHICLE_ICON_IMAGE.boat, boat),
    addRasterIcon(map, VEHICLE_ICON_IMAGE.bus, bus),
    addRasterIcon(map, VEHICLE_ICON_IMAGE.metro, metro),
    addRasterIcon(map, SATELLITE_ICON_IMAGE, sat),
  ])
}
