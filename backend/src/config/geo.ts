/** Loose query box for upstream APIs (OpenSky, AIS). Display filter uses `data/france-zone.geojson`. */
export const FRANCE_BBOX = {
  lamin: 41.3,
  lamax: 51.2,
  lomin: -5.5,
  lomax: 9.8,
}

/** AISstream expects [[lat, lon], [lat, lon]] corners. */
export const FRANCE_AIS_BBOX: [[number, number], [number, number]] = [
  [FRANCE_BBOX.lamin, FRANCE_BBOX.lomin],
  [FRANCE_BBOX.lamax, FRANCE_BBOX.lomax],
]
