import type { Progress } from './progress.ts'
import { scenarios, type Difficulty, type EmailScenario, type MessageScenario, type Scenario } from './scenarios.ts'

export const badges = [
  { id: 'first-steps', name: 'First Steps', condition: 'Complete all three scenarios in a mission.' },
  { id: 'good-catch', name: 'Good Catch', condition: 'Correctly report a scam text or email.' },
  { id: 'comeback', name: 'Comeback', condition: 'Get a scenario right after missing it on your last try.' },
] as const
export type BadgeId = typeof badges[number]['id']
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
export const emptyAdventure = (): Adventure => ({ version: 1, mission: null, completedMissions: 0, earned: {}, tipSeen: false, processed: [] })
export const missionComplete = (mission: Mission) => mission.completed.length === 3
export const missionNext = (mission: Mission) => mission.scenarioIds.find(id => !mission.completed.includes(id))
export const missionUrl = (mission: Mission, scenarioId = missionNext(mission)) => `/train/${encodeURIComponent(scenarioId!)}?mission=${encodeURIComponent(mission.id)}`

/** Choose two scams and a genuine message at the nearest available difficulty; keep the order varied. */
export function createMission(progress: Progress, difficulty: Difficulty, id: string, list: Scenario[] = scenarios): Mission {
  const levels = ['easy', 'medium', 'hard']
  const pick = (type: 'email' | 'sms' | null, action: 'report' | 'safe') => {
    const candidates = list.filter((s): s is MessageScenario => s.type !== 'call' && (!type || s.type === type) && s.correctAction === action)
    candidates.sort((a, b) => {
      const rank = (s: MessageScenario) => Math.abs(levels.indexOf(s.difficulty) - levels.indexOf(difficulty)) * 3 + (progress[s.id]?.correct ? 2 : progress[s.id] ? 1 : 0)
      return rank(a) - rank(b)
    })
    if (!candidates.length) throw new Error('Practice scenarios are unavailable.')
    return candidates[0].id
  }
  const ids = [pick('email', 'report'), pick('sms', 'report'), pick(null, 'safe')]
  const rotation = [...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 3
  return { id, scenarioIds: [...ids.slice(rotation), ...ids.slice(0, rotation)], completed: [], ready: false }
}

/** Replaces only the email scam; never discards the selected mission or its completed steps. */
export function prepareMission(state: Adventure, missionId: string, generated?: EmailScenario): Adventure {
  const mission = state.mission
  if (!mission || mission.id !== missionId || mission.ready) return state
  const scenarioIds = [...mission.scenarioIds]
  if (generated) {
    const index = scenarioIds.findIndex(id => scenarios.some(s => s.id === id && s.type === 'email' && s.correctAction === 'report'))
    if (index >= 0) scenarioIds[index] = generated.id
  }
  return { ...state, mission: { ...mission, scenarioIds, ready: true, ...(generated ? { generated } : {}) } }
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
/** One attempt, one reward; a wrong answer still completes the current mission step. */
export function completeAdventure(state: Adventure, result: AdventureResult): Adventure {
  if (state.processed.includes(result.attemptId)) return state
  const earned = { ...state.earned }
  if (result.correct && result.scam) earned['good-catch'] ??= result.at
  if (result.correct && result.previouslyMissed) earned.comeback ??= result.at
  let mission = state.mission
  let completedMissions = state.completedMissions
  if (mission?.ready && mission.id === result.missionId && missionNext(mission) === result.scenarioId) {
    mission = { ...mission, completed: [...mission.completed, result.scenarioId] }
    if (missionComplete(mission)) {
      completedMissions++
      earned['first-steps'] ??= result.at
    }
  }
  return { ...state, mission, completedMissions, earned, tipSeen: true, processed: [...state.processed, result.attemptId].slice(-128) }
}

export function readAdventure(raw: string | null): Adventure | null {
  try {
    if (!raw) return null
    const s = JSON.parse(raw)
    const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
    if (s.version !== 1 || !Number.isInteger(s.completedMissions) || s.completedMissions < 0 || typeof s.tipSeen !== 'boolean' || !strings(s.processed) || s.processed.length > 128 || !s.earned || typeof s.earned !== 'object' || Array.isArray(s.earned)) return null
    if (Object.entries(s.earned).some(([id, at]) => !badges.some(b => b.id === id) || typeof at !== 'number' || !Number.isFinite(at))) return null
    const m = s.mission
    if (m !== null) {
      if (!m || typeof m.id !== 'string' || typeof m.ready !== 'boolean' || !strings(m.scenarioIds) || m.scenarioIds.length !== 3 || new Set(m.scenarioIds).size !== 3 || !strings(m.completed) || new Set(m.completed).size !== m.completed.length || m.completed.some((id: string, i: number) => m.scenarioIds[i] !== id) || (!m.ready && m.completed.length > 0)) return null
      const g = m.generated
      if (g) {
        const fields = ['title', 'summary', 'situation', 'fromName', 'fromAddress', 'subject', 'receivedAt', 'explanation', 'nextTime']
        if (g.type !== 'email' || typeof g.id !== 'string' || !g.id.startsWith('gen-email-') || g.correctAction !== 'report' || !['easy', 'medium', 'hard'].includes(g.difficulty) || !strings(g.body) || !g.body.length || fields.some(key => typeof g[key] !== 'string') || !Array.isArray(g.indicators) || g.indicators.some((i: { title?: unknown; detail?: unknown; quote?: unknown } | null) => !i || typeof i.title !== 'string' || typeof i.detail !== 'string' || (i.quote !== undefined && typeof i.quote !== 'string')) || (g.links !== undefined && !strings(g.links))) return null
      }
      if (m.scenarioIds.some((id: string) => id !== m.generated?.id && !scenarios.some(s => s.id === id && s.type !== 'call'))) return null
    }
    return s as Adventure
  } catch { return null }
}
