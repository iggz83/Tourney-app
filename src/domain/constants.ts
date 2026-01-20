import type { Club, Division, EventType, SeededEvent, SkillDivisionCode } from './types'

export const CLUBS: Club[] = [
  // Default full names start blank (user fills in "Club Directory" as needed).
  { id: 'NPC', name: '', code: 'NPC' },
  { id: 'IPG', name: '', code: 'IPG' },
  { id: 'PR', name: '', code: 'PR' },
  { id: 'PUP', name: '', code: 'PUP' },
]

export const SKILL_DIVISIONS: Division[] = [
  { id: 'd-3u', code: '3U', name: '3.0 & Under' },
  { id: 'd-3035', code: '3035', name: '3.0–3.5' },
  { id: 'd-3540', code: '3540', name: '3.5–4.0' },
  { id: 'd-4043', code: '4043', name: '4.0–4.3' },
]

export const SKILL_DIVISION_CODES: SkillDivisionCode[] = ['3U', '3035', '3540', '4043']

export const EVENT_TYPES: EventType[] = ['WOMENS_DOUBLES', 'MENS_DOUBLES', 'MIXED_DOUBLES']

export const SEEDED_EVENTS: SeededEvent[] = [
  { eventType: 'WOMENS_DOUBLES', seed: 1, label: "Women #1" },
  { eventType: 'WOMENS_DOUBLES', seed: 2, label: "Women #2" },
  { eventType: 'MENS_DOUBLES', seed: 1, label: "Men #1" },
  { eventType: 'MENS_DOUBLES', seed: 2, label: "Men #2" },
  { eventType: 'MIXED_DOUBLES', seed: 1, label: "Mixed #1" },
  { eventType: 'MIXED_DOUBLES', seed: 2, label: "Mixed #2" },
  { eventType: 'MIXED_DOUBLES', seed: 3, label: "Mixed #3" },
  { eventType: 'MIXED_DOUBLES', seed: 4, label: "Mixed #4" },
]

/**
 * Court mapping is based on Seed + Event Type, with *two simultaneous matchups per round*.
 * matchupIndex: 0 = first matchup in the round, 1 = second matchup in the round.
 */
export const COURTS_BY_EVENT_AND_SEED: Record<
  EventType,
  Record<number, readonly [number, number]>
> = {
  WOMENS_DOUBLES: {
    1: [13, 14],
    2: [9, 10],
  },
  MENS_DOUBLES: {
    1: [15, 16],
    2: [11, 12],
  },
  MIXED_DOUBLES: {
    1: [13, 14],
    2: [15, 16],
    3: [9, 10],
    4: [11, 12],
  },
}

// NOTE: Round-robin scheduling is now generated dynamically for any number of clubs.

