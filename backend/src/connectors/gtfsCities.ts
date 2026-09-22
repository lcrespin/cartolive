import { hub } from '../hub/store.js'
import { settings } from '../config/settings.js'
import { fetchGtfsRtBuffer, parseVehiclePositions } from './gtfsRt.js'

const POLL_MS = 30_000

interface CityFeed {
  id: string
  prefix: string
  url: string
}

function loadFeeds(): CityFeed[] {
  const raw = settings.gtfsRtFeedsJson
  try {
    const parsed = JSON.parse(raw) as CityFeed[]
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn('[gtfs-cities] GTFS_RT_FEEDS is empty — no extra-city pollers')
      return []
    }
    return parsed.filter((f) => f.id && f.prefix && f.url)
  } catch {
    console.warn('[gtfs-cities] GTFS_RT_FEEDS is not valid JSON — no extra-city pollers')
    return []
  }
}

async function pollFeed(feed: CityFeed): Promise<void> {
  try {
    const buffer = await fetchGtfsRtBuffer(feed.url)
    const vehicles = parseVehiclePositions(buffer, 'bus', feed.prefix)
    hub.replaceByPrefix('bus', feed.prefix, vehicles)
    hub.setFeedHealth(`gtfs_${feed.id}`, {
      ok: true,
      lastSuccessAt: new Date().toISOString(),
      lastError: vehicles.length === 0 ? '0 vehicle positions in feed' : null,
      vehicleCount: vehicles.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    hub.setFeedHealth(`gtfs_${feed.id}`, {
      ok: false,
      lastError: msg,
      vehicleCount: hub.countByPrefix('bus', feed.prefix),
    })
    if (!/404/.test(msg)) console.warn(`[gtfs-cities] ${feed.id}:`, msg)
  }
}

export function startGtfsCities(): void {
  const feeds = loadFeeds()
  console.log(`[gtfs-cities] ${feeds.length} extra VP feeds (staggered)`)
  feeds.forEach((feed, i) => {
    hub.setFeedHealth(`gtfs_${feed.id}`, {
      ok: false,
      lastError: 'starting',
      vehicleCount: 0,
    })
    const run = () => void pollFeed(feed)
    setTimeout(run, i * 2500)
    setInterval(run, POLL_MS)
  })
}
