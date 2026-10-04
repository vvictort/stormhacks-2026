import {
  scenarios,
  type Channel,
  type Difficulty,
  type Scenario,
} from './scenarios.ts'

// Texts and emails (and call practice-mode results) are saved in localStorage per account. Live calls are stored
// by the backend and read from GET /api/training/progress; mergeProgress folds them in, so the rest of this module
// never cares where an attempt came from. Moving texts/emails server-side means dropping the local half here.

export interface Attempt {
  correct: boolean
  at: number
}
/** Per scenario id: the latest attempt, plus every attempt oldest first. Old saves have no `history`; their one attempt stands in. */
export type Progress = Record<string, Attempt & { history?: Attempt[] }>

const memory = new Map<string, Progress>()
const keyFor = (uid: string | null | undefined) =>
  `tellio.progress.${uid ?? 'guest'}`

export function loadProgress(uid: string | null | undefined): Progress {
  const key = keyFor(uid)
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Progress
      }
    }
  } catch {
    // Storage blocked or corrupt: fall through to memory.
  }
  return memory.get(key) ?? {}
}

export function saveProgress(
  uid: string | null | undefined,
  progress: Progress,
) {
  const key = keyFor(uid)
  memory.set(key, progress)
  try {
    localStorage.setItem(key, JSON.stringify(progress))
  } catch {
    // Memory copy keeps the session working.
  }
}

export function recordAttempt(
  progress: Progress,
  id: string,
  correct: boolean,
  at = Date.now(),
): Progress {
  const history = [
    ...(progress[id] ? (progress[id].history ?? [progress[id]]) : []),
    { correct, at },
  ]
  return { ...progress, [id]: { correct, at, history } }
}

/** One attempt from `GET /api/training/progress` (docs/call-integration.md). */
export interface ServerAttempt {
  id: string
  channel: string
  scenarioId: string
  scenarioTitle?: string
  difficulty?: Difficulty
  outcome: string
  /** null: not scored. */
  success: boolean | null
  completedAt: string
}

/** Local progress plus the server's scored call attempts, each scenario's history re-sorted oldest first. */
export function mergeProgress(
  local: Progress,
  attempts: ServerAttempt[],
): Progress {
  const extra = new Map<string, Attempt[]>()
  for (const attempt of attempts) {
    const at = Date.parse(attempt.completedAt)
    if (
      attempt.channel !== 'call' ||
      typeof attempt.success !== 'boolean' ||
      Number.isNaN(at)
    ) {
      continue
    }
    extra.set(attempt.scenarioId, [
      ...(extra.get(attempt.scenarioId) ?? []),
      { correct: attempt.success, at },
    ])
  }
  if (extra.size === 0) return local
  const merged = { ...local }
  for (const [id, added] of extra) {
    const history = [
      ...(merged[id] ? (merged[id].history ?? [merged[id]]) : []),
      ...added,
    ].sort((a, b) => a.at - b.at)
    merged[id] = { ...history[history.length - 1], history }
  }
  return merged
}

/** Every attempt across scenarios, oldest first. */
export function timeline(progress: Progress) {
  return Object.entries(progress)
    .flatMap(([id, latest]) =>
      (latest.history ?? [latest]).map(({ correct, at }) => ({
        id,
        correct,
        at,
      })),
    )
    .sort((a, b) => a.at - b.at)
}

export const levels: Difficulty[] = ['easy', 'medium', 'hard']

/** Replays the history: two right calls at or above the level step up, a miss at or below it steps back. */
// ponytail: heuristic stand-in for the planned Python personalization engine (backend/personalization/); swap in its pick once that service exists.
export function currentLevel(
  progress: Progress,
  list: Scenario[] = scenarios,
): Difficulty {
  let level = 0
  let streak = 0
  for (const attempt of timeline(progress)) {
    const scenario = list.find((item) => item.id === attempt.id)
    if (!scenario) continue
    const difficulty = levels.indexOf(scenario.difficulty)
    if (!attempt.correct && difficulty <= level) {
      level = Math.max(0, level - 1)
      streak = 0
    } else if (attempt.correct && difficulty >= level && ++streak === 2) {
      level = Math.min(levels.length - 1, level + 1)
      streak = 0
    }
  }
  return levels[level]
}

export function summarize(progress: Progress, list: Scenario[] = scenarios) {
  const done = list.filter((scenario) => progress[scenario.id])
  return {
    total: list.length,
    done: done.length,
    correct: done.filter((scenario) => progress[scenario.id].correct).length,
  }
}

/**
 * Every attempt, repeats included, per channel. Scenarios made for you count under their channel (`gen-<channel>-…`);
 * ids no longer in the library count as `other`.
 */
export function channelStats(
  progress: Progress,
  list: Pick<Scenario, 'id' | 'type'>[] = scenarios,
) {
  const stats = {
    sms: { attempts: 0, right: 0 },
    email: { attempts: 0, right: 0 },
    call: { attempts: 0, right: 0 },
    other: { attempts: 0, right: 0 },
  }
  for (const attempt of timeline(progress)) {
    const type =
      list.find((scenario) => scenario.id === attempt.id)?.type ??
      (/^gen-(sms|email|call)-/.exec(attempt.id)?.[1] as Channel | undefined)
    const bucket = stats[type ?? 'other']
    bucket.attempts++
    if (attempt.correct) bucket.right++
  }
  return stats
}

/**
 * The scenario to practise next: closest to the current level first, untried before missed at each level,
 * ties in list order starting after `afterId`. Nothing once every scenario's latest call was right.
 */
export function recommend(
  progress: Progress,
  afterId?: string,
  list: Scenario[] = scenarios,
): Scenario | undefined {
  const level = levels.indexOf(currentLevel(progress, list))
  const start = list.findIndex((scenario) => scenario.id === afterId) + 1
  const rank = (scenario: Scenario) =>
    Math.abs(levels.indexOf(scenario.difficulty) - level) * 2 +
    (progress[scenario.id] ? 1 : 0)
  return [...list.slice(start), ...list.slice(0, start)]
    .filter(
      (scenario) => scenario.id !== afterId && !progress[scenario.id]?.correct,
    )
    .sort((a, b) => rank(a) - rank(b))[0]
}
