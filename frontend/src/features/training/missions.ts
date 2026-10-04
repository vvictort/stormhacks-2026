import type { Progress } from './progress.ts'
import { isScored, type CallResult } from './callOutcome.ts'
import {
  scenarios,
  type Channel,
  type Difficulty,
  type EmailScenario,
  type Scenario,
} from './scenarios.ts'

export const badges = [
  {
    id: 'first-steps',
    name: 'First Steps',
    condition: 'Complete all three scenarios in a mission.',
  },
  {
    id: 'good-catch',
    name: 'Good Catch',
    condition: 'Report a scam message or resist a scam call.',
  },
  {
    id: 'comeback',
    name: 'Comeback',
    condition: 'Get a scenario right after missing it on your last try.',
  },
] as const
export type BadgeId = (typeof badges)[number]['id']

export interface Mission {
  id: string
  scenarioIds: string[]
  completed: string[]
  ready: boolean
  generated?: EmailScenario
}

export interface Adventure {
  version: 1
  mission: Mission | null
  completedMissions: number
  earned: Partial<Record<BadgeId, number>>
  tipSeen: boolean
  processed: string[]
}

export const emptyAdventure = (): Adventure => ({
  version: 1,
  mission: null,
  completedMissions: 0,
  earned: {},
  tipSeen: false,
  processed: [],
})

export const missionComplete = (mission: Mission) =>
  mission.completed.length === 3

export const missionNext = (mission: Mission) =>
  mission.scenarioIds.find((id) => !mission.completed.includes(id))

export const missionUrl = (
  mission: Mission,
  scenarioId = missionNext(mission),
) =>
  `/train/${encodeURIComponent(scenarioId!)}?mission=${encodeURIComponent(mission.id)}`

const levels = ['easy', 'medium', 'hard']
const levelGap = (a: Difficulty, b: Difficulty) =>
  Math.abs(levels.indexOf(a) - levels.indexOf(b))

/**
 * One of each channel, with one genuine message, near the learner's difficulty
 * and in varied order.
 */
export function createMission(
  progress: Progress,
  difficulty: Difficulty,
  id: string,
  list: Scenario[] = scenarios,
): Mission {
  // Among scenarios of the closest difficulty: untried first, then missed,
  // then already right.
  const familiarity = (s: Scenario) => {
    const attempt = progress[s.id]
    if (!attempt) return 0
    return attempt.correct ? 2 : 1
  }
  const rank = (s: Scenario) =>
    levelGap(s.difficulty, difficulty) * 3 + familiarity(s)

  const pick = (type: Channel, action?: 'report' | 'safe') => {
    const candidates = list.filter(
      (s) =>
        s.type === type && (s.type === 'call' || s.correctAction === action),
    )
    candidates.sort((a, b) => rank(a) - rank(b))
    if (!candidates.length) {
      throw new Error('Practice scenarios are unavailable.')
    }
    return candidates[0].id
  }

  const rotation = [...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 3
  const genuineEmail = rotation === 1
  const ids = [
    pick('email', genuineEmail ? 'safe' : 'report'),
    pick('sms', genuineEmail ? 'report' : 'safe'),
    pick('call'),
  ]
  return {
    id,
    scenarioIds: [...ids.slice(rotation), ...ids.slice(0, rotation)],
    completed: [],
    ready: false,
  }
}

/**
 * The mission's steps with the generated email in place of its scam email, or
 * null when it has none to replace.
 *
 * A genuine generated email would leave a mission that has a call with two
 * genuine messages, so its genuine text is then swapped for the scam text
 * closest in difficulty.
 */
function swapInGenerated(scenarioIds: string[], generated: EmailScenario) {
  const ids = [...scenarioIds]
  const steps = ids.map((id) => scenarios.find((s) => s.id === id))

  const emailIndex = steps.findIndex(
    (s) => s?.type === 'email' && s.correctAction === 'report',
  )
  if (emailIndex < 0) return null
  ids[emailIndex] = generated.id

  const hasCall = steps.some((s) => s?.type === 'call')
  if (generated.correctAction !== 'safe' || !hasCall) return ids

  const textIndex = steps.findIndex(
    (s) => s?.type === 'sms' && s.correctAction === 'safe',
  )
  if (textIndex < 0) return ids

  const text = steps[textIndex]!
  const scamTexts = scenarios
    .filter((s) => s.type === 'sms' && s.correctAction === 'report')
    .sort(
      (a, b) =>
        levelGap(a.difficulty, text.difficulty) -
        levelGap(b.difficulty, text.difficulty),
    )
  if (scamTexts.length) ids[textIndex] = scamTexts[0].id
  return ids
}

/**
 * Personalizes the selected email; a genuine result keeps mixed-channel
 * missions balanced.
 */
export function prepareMission(
  state: Adventure,
  missionId: string,
  generated?: EmailScenario,
): Adventure {
  const mission = state.mission
  if (!mission || mission.id !== missionId || mission.ready) return state

  const swapped = generated
    ? swapInGenerated(mission.scenarioIds, generated)
    : null

  return {
    ...state,
    mission: {
      ...mission,
      scenarioIds: swapped ?? [...mission.scenarioIds],
      ready: true,
      ...(swapped && generated ? { generated } : {}),
    },
  }
}

export interface AdventureResult {
  attemptId: string
  scenarioId: string
  correct: boolean
  scam: boolean
  previouslyMissed: boolean
  missionId: string | null
  at: number
}

/**
 * One attempt, one reward; a wrong answer still completes the current mission
 * step.
 */
export function completeAdventure(
  state: Adventure,
  result: AdventureResult,
): Adventure {
  if (state.processed.includes(result.attemptId)) return state

  const earned = { ...state.earned }
  if (result.correct && result.scam) earned['good-catch'] ??= result.at
  if (result.correct && result.previouslyMissed) earned.comeback ??= result.at

  let mission = state.mission
  let completedMissions = state.completedMissions
  if (
    mission?.ready &&
    mission.id === result.missionId &&
    missionNext(mission) === result.scenarioId
  ) {
    mission = {
      ...mission,
      completed: [...mission.completed, result.scenarioId],
    }
    if (missionComplete(mission)) {
      completedMissions++
      earned['first-steps'] ??= result.at
    }
  }

  return {
    ...state,
    mission,
    completedMissions,
    earned,
    tipSeen: true,
    processed: [...state.processed, result.attemptId].slice(-128),
  }
}

/**
 * Errors never consume a step. Resisting earns Good Catch; declining/ringing
 * out still completes the call.
 */
export function completeCallAdventure(
  state: Adventure,
  result: Omit<AdventureResult, 'correct' | 'scam'> & {
    result: CallResult | null
  },
): Adventure {
  if (!isScored(result.result)) return state
  return completeAdventure(state, {
    ...result,
    correct: result.result.success,
    scam: result.result.outcome === 'resisted',
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const oneOf = (options: string[], value: unknown) =>
  options.some((option) => option === value)

const GENERATED_TEXT_FIELDS = [
  'title',
  'summary',
  'situation',
  'fromName',
  'fromAddress',
  'subject',
  'receivedAt',
  'explanation',
  'nextTime',
]

function validEarned(earned: unknown) {
  return (
    isRecord(earned) &&
    Object.entries(earned).every(
      ([id, at]) =>
        badges.some((badge) => badge.id === id) &&
        typeof at === 'number' &&
        Number.isFinite(at),
    )
  )
}

function validIndicator(indicator: unknown) {
  return (
    isRecord(indicator) &&
    typeof indicator.title === 'string' &&
    typeof indicator.detail === 'string' &&
    (indicator.quote === undefined || typeof indicator.quote === 'string')
  )
}

function validGeneratedEmail(email: unknown) {
  return (
    isRecord(email) &&
    email.type === 'email' &&
    typeof email.id === 'string' &&
    email.id.startsWith('gen-email-') &&
    oneOf(['report', 'safe'], email.correctAction) &&
    oneOf(['easy', 'medium', 'hard'], email.difficulty) &&
    isStrings(email.body) &&
    email.body.length > 0 &&
    GENERATED_TEXT_FIELDS.every((key) => typeof email[key] === 'string') &&
    Array.isArray(email.indicators) &&
    email.indicators.every(validIndicator) &&
    (email.links === undefined || isStrings(email.links))
  )
}

function validMission(mission: unknown) {
  if (!isRecord(mission)) return false

  const { id, ready, scenarioIds, completed, generated } = mission
  if (typeof id !== 'string' || typeof ready !== 'boolean') return false
  if (!isStrings(scenarioIds) || !isStrings(completed)) return false
  if (scenarioIds.length !== 3 || new Set(scenarioIds).size !== 3) return false

  // Completed steps are the mission's first steps, in order and without
  // repeats, and a mission that isn't ready has none.
  if (
    new Set(completed).size !== completed.length ||
    completed.some((step, index) => scenarioIds[index] !== step) ||
    (!ready && completed.length > 0)
  ) {
    return false
  }

  if (generated && !validGeneratedEmail(generated)) return false

  const generatedId = isRecord(generated) ? generated.id : undefined
  return scenarioIds.every(
    (step) =>
      step === generatedId ||
      scenarios.some((scenario) => scenario.id === step),
  )
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isAdventure(state: unknown): state is Adventure {
  return (
    isRecord(state) &&
    state.version === 1 &&
    typeof state.completedMissions === 'number' &&
    Number.isInteger(state.completedMissions) &&
    state.completedMissions >= 0 &&
    typeof state.tipSeen === 'boolean' &&
    isStrings(state.processed) &&
    state.processed.length <= 128 &&
    validEarned(state.earned) &&
    (state.mission === null || validMission(state.mission))
  )
}

/** The saved adventure, or null if it is missing, corrupt or out of date. */
export function readAdventure(raw: string | null): Adventure | null {
  if (!raw) return null

  const state = parseJson(raw)
  return isAdventure(state) ? state : null
}
