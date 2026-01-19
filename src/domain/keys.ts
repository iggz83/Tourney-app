import type { EventType, SeedKey } from './types'

export function seedKey(eventType: EventType, seed: number): SeedKey {
  return `${eventType}:${seed}` as SeedKey
}

