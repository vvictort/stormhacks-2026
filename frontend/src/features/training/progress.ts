import { scenarios, type Scenario } from './scenarios.ts'

// ponytail: progress is mocked in localStorage per account; move to the backend once attempts are stored server-side.

export interface Attempt { correct: boolean; at: number }
/** Latest attempt per scenario id. */
export type Progress = Record<string, Attempt>

const memory = new Map<string, Progress>()
const keyFor = (uid: string | null | undefined) => `tellio.progress.${uid ?? 'guest'}`

export function loadProgress(uid: string | null | undefined): Progress {
  const key = keyFor(uid)
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Progress
    }
  } catch {
    // Storage blocked or corrupt: fall through to memory.
  }
  return memory.get(key) ?? {}
}

export function saveProgress(uid: string | null | undefined, progress: Progress) {
  const key = keyFor(uid)
  memory.set(key, progress)
  try {
    localStorage.setItem(key, JSON.stringify(progress))
  } catch {
    // Memory copy keeps the session working.
  }
}

export function recordAttempt(progress: Progress, id: string, correct: boolean, at = Date.now()): Progress {
  return { ...progress, [id]: { correct, at } }
}

export function summarize(progress: Progress, list: Scenario[] = scenarios) {
  const done = list.filter((scenario) => progress[scenario.id])
  return { total: list.length, done: done.length, correct: done.filter((scenario) => progress[scenario.id].correct).length }
}

/** The scenario to practise next: untried first, then ones answered wrong, starting after `afterId`. */
export function recommend(progress: Progress, afterId?: string, list: Scenario[] = scenarios): Scenario | undefined {
  const start = list.findIndex((scenario) => scenario.id === afterId) + 1
  const order = [...list.slice(start), ...list.slice(0, start)].filter((scenario) => scenario.id !== afterId)
  return order.find((scenario) => !progress[scenario.id]) ?? order.find((scenario) => !progress[scenario.id].correct)
}
