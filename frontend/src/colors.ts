/** Single source of truth for vehicle-type colors (map, layers, pictos, popups). */
export const VEHICLE_COLORS = {
  plane: '#D5DAE1',
  train: '#5FBF6E',
  boat: '#4A9EDB',
  bus: '#D97757',
  metro: '#D97757',
} as const satisfies Record<'plane' | 'train' | 'boat' | 'bus' | 'metro', string>

export const SATELLITE_COLOR = '#F0E15A'

/** @deprecated Prefer VEHICLE_COLORS */
export const LAYER_COLORS = VEHICLE_COLORS

export function applyVehicleColorTokens(root: HTMLElement = document.documentElement): void {
  for (const [type, hex] of Object.entries(VEHICLE_COLORS)) {
    root.style.setProperty(`--${type}`, hex)
  }
  root.style.setProperty('--sat', SATELLITE_COLOR)
}
