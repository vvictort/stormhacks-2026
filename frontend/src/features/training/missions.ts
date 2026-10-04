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
  const levels = ['easy', 'medium', 'hard']
  const pick = (type: Channel, action?: 'report' | 'safe') => {
    const candidates = list.filter(
      (s) =>
        s.type === type && (s.type === 'call' || s.correctAction === action),
    )
    candidates.sort((a, b) => {
      const rank = (s: Scenario) =>
        Math.abs(levels.indexOf(s.difficulty) - levels.indexOf(difficulty)) *
          3 +
        (progress[s.id]?.correct ? 2 : progress[s.id] ? 1 : 0)
      return rank(a) - rank(b)
    })
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

  const scenarioIds = [...mission.scenarioIds]
  let selectedEmail: EmailScenario | undefined
  if (generated) {
    const index = scenarioIds.findIndex((id) =>
      scenarios.some(
        (s) =>
          s.id === id && s.type === 'email' && s.correctAction === 'report',
      ),
    )
    if (index >= 0) {
      scenarioIds[index] = generated.id
      selectedEmail = generated
      if (
        generated.correctAction === 'safe' &&
        scenarioIds.some((id) =>
          scenarios.some((s) => s.id === id && s.type === 'call'),
        )
      ) {
        const textIndex = scenarioIds.findIndex((id) =>
          scenarios.some(
            (s) =>
              s.id === id && s.type === 'sms' && s.correctAction === 'safe',
          ),
        )
        if (textIndex >= 0) {
          const text = scenarios.find((s) => s.id === scenarioIds[textIndex])!
          const levels = ['easy', 'medium', 'hard']
          const candidates = scenarios.filter(
            (s) => s.type === 'sms' && s.correctAction === 'report',
          )
          candidates.sort(
            (a, b) =>
              Math.abs(
                levels.indexOf(a.difficulty) - levels.indexOf(text.difficulty),
              ) -
              Math.abs(
                levels.indexOf(b.difficulty) - levels.indexOf(text.difficulty),
              ),
          )
          if (candidates.length) scenarioIds[textIndex] = candidates[0].id
        }
      }
    }
  }

  return {
    ...state,
    mission: {
      ...mission,
      scenarioIds,
      ready: true,
      ...(selectedEmail ? { generated: selectedEmail } : {}),
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

export function readAdventure(raw: string | null): Adventure | null {
  try {
    if (!raw) return null
    const s = JSON.parse(raw)
    const strings = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((x) => typeof x === 'string')

    if (
      s.version !== 1 ||
      !Number.isInteger(s.completedMissions) ||
      s.completedMissions < 0 ||
      typeof s.tipSeen !== 'boolean' ||
      !strings(s.processed) ||
      s.processed.length > 128 ||
      !s.earned ||
      typeof s.earned !== 'object' ||
      Array.isArray(s.earned)
    ) {
      return null
    }
    if (
      Object.entries(s.earned).some(
        ([id, at]) =>
          !badges.some((b) => b.id === id) ||
          typeof at !== 'number' ||
          !Number.isFinite(at),
      )
    ) {
      return null
    }

    const m = s.mission
    if (m !== null) {
      if (
        !m ||
        typeof m.id !== 'string' ||
        typeof m.ready !== 'boolean' ||
        !strings(m.scenarioIds) ||
        m.scenarioIds.length !== 3 ||
        new Set(m.scenarioIds).size !== 3 ||
        !strings(m.completed) ||
        new Set(m.completed).size !== m.completed.length ||
        m.completed.some((id: string, i: number) => m.scenarioIds[i] !== id) ||
        (!m.ready && m.completed.length > 0)
      ) {
        return null
      }

      const g = m.generated
      if (g) {
        const fields = [
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
        if (
          g.type !== 'email' ||
          typeof g.id !== 'string' ||
          !g.id.startsWith('gen-email-') ||
          !['report', 'safe'].includes(g.correctAction) ||
          !['easy', 'medium', 'hard'].includes(g.difficulty) ||
          !strings(g.body) ||
          !g.body.length ||
          fields.some((key) => typeof g[key] !== 'string') ||
          !Array.isArray(g.indicators) ||
          g.indicators.some(
            (
              i: { title?: unknown; detail?: unknown; quote?: unknown } | null,
            ) =>
              !i ||
              typeof i.title !== 'string' ||
              typeof i.detail !== 'string' ||
              (i.quote !== undefined && typeof i.quote !== 'string'),
          ) ||
          (g.links !== undefined && !strings(g.links))
        ) {
          return null
        }
      }

      if (
        m.scenarioIds.some(
          (id: string) =>
            id !== m.generated?.id && !scenarios.some((s) => s.id === id),
        )
      ) {
        return null
      }
    }

    return s as Adventure
  } catch {
    return null
  }
}
