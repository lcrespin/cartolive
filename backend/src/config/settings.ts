/** Read from process.env (after dotenv). Empty string is kept; unset uses fallback. */
function env(name: string, fallback = ''): string {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  return raw
}

function envOptional(name: string): string | undefined {
  const v = env(name).trim()
  return v ? v : undefined
}

export const settings = {
  port: Number(env('PORT', '3001')),
  host: env('HOST', '0.0.0.0'),

  openskyClientId: env('OPENSKY_CLIENT_ID'),
  openskyClientSecret: env('OPENSKY_CLIENT_SECRET'),
  aisstreamApiKey: env('AISSTREAM_API_KEY'),
  impactCo2ApiKey: env('IMPACT_CO2_API_KEY'),

  sncfGtfsRtUrl: env(
    'SNCF_GTFS_RT_URL',
    'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates',
  ),
  sncfGtfsStaticUrl: env(
    'SNCF_GTFS_STATIC_URL',
    'https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip',
  ),

  /** Set for true VehiclePositions; leave empty for trip-updates + stops (approximate). */
  idfmGtfsRtUrl: envOptional('IDFM_GTFS_RT_URL'),
  idfmTripUpdatesUrl: env(
    'IDFM_TRIP_UPDATES_URL',
    'http://gtfsidfm.clarifygdps.com/gtfs-rt-trips-idfm',
  ),
  idfmStopsUrl: env(
    'IDFM_STOPS_URL',
    'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/exports/csv',
  ),

  gtfsRtFeedsJson: env(
    'GTFS_RT_FEEDS',
    '[{"id":"lyon","prefix":"lyon-","url":"https://proxy.transport.data.gouv.fr/resource/tcl-lyon-gtfs-rt-vehicle-position"},{"id":"marseille","prefix":"mrs-","url":"https://proxy.transport.data.gouv.fr/resource/rtm-marseille-gtfs-rt-vehicle-position"},{"id":"toulouse","prefix":"tls-","url":"https://api.tisseo.fr/opendata/gtfsrt/GtfsRt.pb"},{"id":"bordeaux","prefix":"bdx-","url":"https://bdx.mecatran.com/utw/ws/gtfsfeed/vehicles/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt"},{"id":"nantes","prefix":"nte-","url":"https://proxy.transport.data.gouv.fr/resource/naolib-nantes-gtfs-rt-vehicle-position"},{"id":"lille","prefix":"lil-","url":"https://proxy.transport.data.gouv.fr/resource/ilevia-lille-gtfs-rt"}]',
  ),

  bisonFuteQtvUrl: env(
    'BISON_FUTE_URL',
    'http://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/QTV-DIR/qtvDir.xml',
  ),
  bisonFuteRefUrl: env(
    'BISON_FUTE_REF_URL',
    'http://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/QTV-DIR/refDir.csv',
  ),
}
