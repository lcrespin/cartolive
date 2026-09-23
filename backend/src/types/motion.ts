/** Straight-line leg between two stops with predicted times (GTFS-RT trip update). */
export interface VehicleMotionLeg {
  fromLon: number
  fromLat: number
  toLon: number
  toLat: number
  startAt: string
  endAt: string
  toLabel?: string
}
