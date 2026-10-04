import type { Outcome, TextMessage, TextThread, ThreadEndReason } from './types'

// Pure state for one simulated text thread, fed by SSE frames, snapshots
// (GET /texts/:id) and the user's own sends. No React; safe to load in Node.

export type ThreadConnection = 'connecting' | 'open' | 'reconnecting' | 'error'

export type TextThreadStatus =
  'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error'

export interface ThreadState {
  threadId: string | null
  connection: ThreadConnection
  /** Deduped by id, in chronological order. */
  messages: TextMessage[]
  /** Scammer is "typing". */
  typing: boolean
  outcome: Outcome | null
  endReason: ThreadEndReason | null
  /** User replies in flight. */
  pendingSends: number
  error: string | null
}

export type ThreadAction =
  | {
      type: 'connection'
      threadId: string
      connection: 'open' | 'reconnecting'
    }
  | { type: 'message'; threadId: string; message: TextMessage }
  | { type: 'typing'; threadId: string; on: boolean }
  | {
      type: 'ended'
      threadId: string
      outcome: Outcome
      reason: ThreadEndReason | null
    }
  | { type: 'snapshot'; threadId: string; thread: TextThread }
  | { type: 'send'; threadId: string; phase: 'start' | 'done' }
  | { type: 'error'; threadId: string; error: string; fatal: boolean }

export const initialThreadState = (threadId: string | null): ThreadState => ({
  threadId,
  connection: 'connecting',
  messages: [],
  typing: false,
  outcome: null,
  endReason: null,
  pendingSends: 0,
  error: null,
})

const time = (message: TextMessage) => Date.parse(message.at)

function addMessage(state: ThreadState, message: TextMessage): ThreadState {
  if (state.messages.some((m) => m.id === message.id)) return state
  const last = state.messages[state.messages.length - 1]
  const messages = [...state.messages, message]
  // Late arrival (e.g. a snapshot racing the stream): restore chronological order.
  if (last && time(last) > time(message)) {
    messages.sort((a, b) => time(a) - time(b))
  }
  return {
    ...state,
    messages,
    typing: message.from === 'scammer' ? false : state.typing,
  }
}

export function threadReducer(
  state: ThreadState,
  action: ThreadAction,
): ThreadState {
  // An action for a different thread starts that thread from scratch.
  const s =
    action.threadId === state.threadId
      ? state
      : initialThreadState(action.threadId)

  switch (action.type) {
    case 'connection':
      if (s.outcome) return s
      return {
        ...s,
        connection: action.connection,
        error: action.connection === 'open' ? null : s.error,
      }

    case 'message':
      return addMessage(s, action.message)

    case 'typing':
      return s.outcome || s.typing === action.on
        ? s
        : { ...s, typing: action.on }

    case 'ended':
      return {
        ...s,
        typing: false,
        outcome: action.outcome,
        endReason: action.reason,
      }

    case 'snapshot': {
      const { thread } = action
      let next = s
      for (const message of thread.messages ?? []) {
        next = addMessage(next, message)
      }
      if (thread.status !== 'ended') return next
      return {
        ...next,
        typing: false,
        // The backend always sets outcome when it ends a thread; 'error' only guards a malformed snapshot.
        outcome: thread.outcome ?? next.outcome ?? 'error',
        endReason: thread.endReason ?? next.endReason,
      }
    }

    case 'send': {
      const pendingSends = Math.max(
        0,
        s.pendingSends + (action.phase === 'start' ? 1 : -1),
      )
      return pendingSends === s.pendingSends ? s : { ...s, pendingSends }
    }

    case 'error':
      return {
        ...s,
        error: action.error,
        connection: action.fatal ? 'error' : s.connection,
      }

    default:
      return s
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function isTextMessage(value: unknown): value is TextMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.at === 'string' &&
    typeof value.body === 'string' &&
    (value.from === 'scammer' || value.from === 'user') &&
    (value.links === undefined || Array.isArray(value.links))
  )
}

/** Maps an SSE frame (`event` name + raw `data`) to a reducer action; null for anything malformed or unknown. */
export function parseThreadEvent(
  event: string,
  data: string,
  threadId: string,
): ThreadAction | null {
  if (event !== 'message' && event !== 'typing' && event !== 'ended') {
    return null
  }

  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch {
    return null
  }
  if (!isRecord(payload)) return null

  if (event === 'message') {
    return isTextMessage(payload)
      ? { type: 'message', threadId, message: payload }
      : null
  }
  if (event === 'typing') {
    return typeof payload.on === 'boolean'
      ? { type: 'typing', threadId, on: payload.on }
      : null
  }

  const { outcome, reason = null } = payload
  if (
    typeof outcome !== 'string' ||
    (reason !== null && typeof reason !== 'string')
  ) {
    return null
  }
  return {
    type: 'ended',
    threadId,
    outcome: outcome as Outcome,
    reason: reason as ThreadEndReason | null,
  }
}

export function threadStatus(state: ThreadState): TextThreadStatus {
  if (!state.threadId) return 'idle'
  if (state.outcome) return 'ended'
  return state.connection === 'open' ? 'live' : state.connection
}
