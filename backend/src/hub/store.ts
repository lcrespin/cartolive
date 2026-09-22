import { filterVehicles } from '../geo/franceZone.js'
import type { FeedHealth, Vehicle, VehicleType } from '../types/vehicle.js'

type HubListener = (vehicles: Vehicle[]) => void

export class VehicleHub {
  private byId = new Map<string, Vehicle>()
  private listeners = new Set<HubListener>()
  private feedHealth = new Map<string, FeedHealth>()
  private emitTimer: ReturnType<typeof setTimeout> | null = null

  upsertMany(vehicles: Vehicle[]): void {
    for (const v of filterVehicles(vehicles)) {
      this.byId.set(`${v.type}:${v.id}`, v)
    }
    this.scheduleEmit()
  }

  replaceType(type: VehicleType, vehicles: Vehicle[]): void {
    for (const key of this.byId.keys()) {
      if (key.startsWith(`${type}:`)) this.byId.delete(key)
    }
    for (const v of filterVehicles(vehicles)) {
      this.byId.set(`${v.type}:${v.id}`, v)
    }
    this.emitNow()
  }

  replaceByPrefix(type: VehicleType, prefix: string, vehicles: Vehicle[]): void {
    const keyPrefix = `${type}:${prefix}`
    for (const key of this.byId.keys()) {
      if (key.startsWith(keyPrefix)) this.byId.delete(key)
    }
    for (const v of filterVehicles(vehicles)) {
      this.byId.set(`${v.type}:${v.id}`, v)
    }
    this.emitNow()
  }

  countByPrefix(type: VehicleType, prefix: string): number {
    const keyPrefix = `${type}:${prefix}`
    let n = 0
    for (const key of this.byId.keys()) if (key.startsWith(keyPrefix)) n++
    return n
  }

  removeStale(type: VehicleType, maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs
    let changed = false
    for (const [key, v] of this.byId) {
      if (v.type !== type) continue
      if (new Date(v.updatedAt).getTime() < cutoff) {
        this.byId.delete(key)
        changed = true
      }
    }
    if (changed) this.emitNow()
  }

  all(): Vehicle[] {
    return [...this.byId.values()]
  }

  countByType(type: VehicleType): number {
    let n = 0
    for (const v of this.byId.values()) if (v.type === type) n++
    return n
  }

  subscribe(listener: HubListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private scheduleEmit(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emitNow()
    }, 1000)
  }

  private emitNow(): void {
    const snapshot = this.all()
    for (const listener of this.listeners) listener(snapshot)
  }

  setFeedHealth(name: string, patch: Partial<FeedHealth> & { ok: boolean }): void {
    const prev = this.feedHealth.get(name)
    this.feedHealth.set(name, {
      name,
      ok: patch.ok,
      lastSuccessAt: patch.lastSuccessAt ?? prev?.lastSuccessAt ?? null,
      lastError: patch.lastError ?? null,
      vehicleCount: patch.vehicleCount ?? prev?.vehicleCount ?? 0,
    })
  }

  health(): FeedHealth[] {
    return [...this.feedHealth.values()]
  }
}

export const hub = new VehicleHub()
