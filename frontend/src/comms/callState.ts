import type { CallRecord } from './types'

// Pure state for one simulated call: ring → connect → talk → analyze → result.
// No React; safe to load in Node.

export type CallPhase = 'idle' | 'starting' | 'ringing' | 'connecting' | 'in_call' | 'analyzing' | 'completed' | 'error'

export interface CallCaption {
  role: 'agent' | 'user'
  message: string
}

export interface CallState {
  phase: CallPhase
  callId: string | null
  callerLabel: string | null
  /** Latest CallRecord from the server (outcome/transcript once completed). */
  record: CallRecord | null
  /** Live captions from the ElevenLabs session. */
  captions: CallCaption[]
  error: string | null
}

export type CallAction =
  | { type: 'start' }
  | { type: 'ringing'; callId: string; callerLabel: string; record: CallRecord }
  | { type: 'connecting'; callId: string }
  | { type: 'connected'; callId: string }
  | { type: 'caption'; callId: string; caption: CallCaption }
  | { type: 'hung_up'; callId: string }
  | { type: 'record'; callId: string; record: CallRecord }
  | { type: 'failed'; callId: string | null; error: string; phase?: CallPhase }
  | { type: 'reset' }

export const INITIAL_CALL_STATE: CallState = {
  phase: 'idle',
  callId: null,
  callerLabel: null,
  record: null,
  captions: [],
  error: null,
}

export function callReducer(state: CallState, action: CallAction): CallState {
  if (action.type === 'start') return { ...INITIAL_CALL_STATE, phase: 'starting' }
  if (action.type === 'reset') return INITIAL_CALL_STATE
  if (action.type === 'ringing') {
    return {
      phase: 'ringing',
      callId: action.callId,
      callerLabel: action.callerLabel,
      record: action.record,
      captions: [],
      error: null,
    }
  }

  // Late events from a previous call (a slow poll, a stale session callback) are ignored.
  if (action.callId !== state.callId) return state

  switch (action.type) {
    case 'connecting':
      return { ...state, phase: 'connecting', error: null }
    case 'connected':
      return { ...state, phase: 'in_call', error: null }
    case 'caption':
      return { ...state, captions: [...state.captions, action.caption] }
    case 'hung_up':
      return { ...state, phase: 'analyzing' }
    case 'record':
      return { ...state, record: action.record, phase: action.record.status === 'completed' ? 'completed' : state.phase }
    case 'failed':
      return { ...state, error: action.error, phase: action.phase ?? state.phase }
    default:
      return state
  }
}

/** Why the microphone can't be used before even asking: getUserMedia needs a secure context (HTTPS or localhost). */
export function microphoneBlocker(env: { secureContext: boolean; getUserMedia: boolean }) {
  if (!env.secureContext) return 'insecure_context'
  if (!env.getUserMedia) return 'microphone_unavailable'
  return null
}

/** Maps a getUserMedia rejection to an error code: a refusal, or no usable microphone. */
export function microphoneErrorCode(error: unknown) {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  return name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError' || name === 'AbortError'
    ? 'microphone_unavailable'
    : 'microphone_denied'
}
