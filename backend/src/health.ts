import { getCelestrakSnapshot } from './connectors/celestrak.js'
import { getRoadSnapshot } from './connectors/bisonFute.js'
import { hub } from './hub/store.js'
import type { FeedHealth } from './types/vehicle.js'

const OVERLAY_FEEDS = new Set(['celestrak', 'bison_fute'])

function feedNamed(feeds: FeedHealth[], name: string): FeedHealth | undefined {
  return feeds.find((f) => f.name === name)
}

export function getHealth() {
  const feeds = hub.health()
  const celestrakFeed = feedNamed(feeds, 'celestrak')
  const roadFeed = feedNamed(feeds, 'bison_fute')
  const celestrak = getCelestrakSnapshot()
  const roadData = getRoadSnapshot()

  const satellites = {
    ok: celestrakFeed?.ok ?? false,
    tleObjects: celestrak.tleObjects,
    groups: celestrak.groups,
    lastSuccessAt: celestrakFeed?.lastSuccessAt ?? null,
    lastError: celestrakFeed?.lastError ?? null,
  }

  const road = {
    ok: roadFeed?.ok ?? false,
    segments: roadData.features.length,
    updatedAt: roadData.updatedAt,
    source: roadData.source,
    lastSuccessAt: roadFeed?.lastSuccessAt ?? null,
    lastError: roadFeed?.lastError ?? null,
  }

  const vehicleFeeds = feeds.filter((f) => !OVERLAY_FEEDS.has(f.name))
  const allFeedsOk =
    vehicleFeeds.every((f) => f.ok) && satellites.ok && road.ok

  return {
    ok: true,
    allFeedsOk,
    vehicles: hub.all().length,
    feeds,
    satellites,
    road,
  }
}
