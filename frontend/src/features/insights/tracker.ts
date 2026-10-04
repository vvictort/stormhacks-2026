import type { Tactic } from '../../comms/types.ts'
import type {
  Action,
  Difficulty,
  MessageScenario,
  ScamCategory,
} from '../training/scenarios.ts'

// Behaviour events for texts and emails, batched to POST /api/training/events (docs/mvp-contracts.md). The backend
// stores them in TigerData; calls are recorded server-side from the call lifecycle. Tracking never affects the UI.

export type TrackedType =
  | 'scenario_started'
  | 'sender_inspected'
  | 'link_clicked'
  | 'message_reported'
  | 'message_marked_safe'
  | 'scenario_completed'
  | 'debrief_viewed'
export type MessageOutcome =
  'reported_correct' | 'reported_incorrect' | 'safe_correct' | 'safe_incorrect'

export interface TrackedEvent {
  type: TrackedType
  channel: MessageScenario['type']
  scenarioId: string
  scenarioTitle: string
  attemptId: string
  difficulty: Difficulty
  scamCategory?: ScamCategory
  outcome?: MessageOutcome
  /** `scenario_completed` only: the scenario's tactics, stored with the attempt so missed tactics shape the profile. */
  tactics?: Tactic[]
  /** Since the run started. */
  responseTimeMs: number
  /** Small facts only (e.g. the practice link's site), never anything the user typed. */
  metadata?: Record<string, string | number | boolean>
  at: string
}

/** One run of a scenario: its own attempt id, timed from when it opened. */
export interface Run {
  attemptId: string
  startedAt: number
}

export const messageOutcome = (
  choice: Action,
  correctAction: Action,
): MessageOutcome =>
  `${choice === 'report' ? 'reported' : 'safe'}_${choice === correctAction ? 'correct' : 'incorrect'}`

export function runEvent(
  scenario: MessageScenario,
  run: Run,
  type: TrackedType,
  extra: Pick<TrackedEvent, 'outcome' | 'metadata'> = {},
  now = performance.now(),
): TrackedEvent {
  return {
    type,
    channel: scenario.type,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    attemptId: run.attemptId,
    difficulty: scenario.difficulty,
    // Built-in scenarios have none; the backend infers it from the id and title.
    ...(scenario.scamCategory ? { scamCategory: scenario.scamCategory } : {}),
    ...(type === 'scenario_completed'
      ? { tactics: scenario.tactics ?? [] }
      : {}),
    responseTimeMs: Math.max(0, Math.round(now - run.startedAt)),
    ...extra,
    at: new Date().toISOString(),
  }
}

/** Queues events and sends them in batches after a short pause; `flush` sends now and resolves once everything sent has settled. */
export function createTracker(
  send: (events: TrackedEvent[], keepalive: boolean) => Promise<unknown>,
  { delayMs = 1500, max = 50 } = {},
) {
  const queue: TrackedEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let inflight: Promise<unknown> = Promise.resolve()

  function flush(keepalive = false) {
    clearTimeout(timer)
    timer = undefined
    const batches: TrackedEvent[][] = []
    while (queue.length) batches.push(queue.splice(0, max))
    // ponytail: a failed batch is dropped, not retried; metrics just miss it.
    const sent = batches.map((batch) =>
      Promise.resolve()
        .then(() => send(batch, keepalive))
        .catch(() => {}),
    )
    inflight = Promise.all([inflight, ...sent])
    return inflight.then(() => {})
  }

  function track(event: TrackedEvent) {
    queue.push(event)
    if (queue.length >= max) void flush()
    else timer ??= setTimeout(() => void flush(), delayMs)
  }

  return { track, flush }
}
