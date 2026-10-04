import { useConversation } from '@elevenlabs/react'
import { useCallback, useEffect, useReducer, useRef } from 'react'
import { comms } from './api'
import { callReducer, INITIAL_CALL_STATE, microphoneBlocker, microphoneErrorCode, type CallCaption, type CallPhase } from './callState'
import { CommsError, describeError, isAbortError } from './client'
import { pollUntilCompleted } from './poll'
import type { CallRecord, DeclineReason, Outcome } from './types'

export interface SimulatedCallHandle {
  phase: CallPhase
  callId: string | null
  callerLabel: string | null
  record: CallRecord | null
  /** Set once the call is completed (analyzed, declined or missed). */
  outcome: Outcome | null
  /** Live captions from this browser's session. Local only and NOT redacted. */
  captions: CallCaption[]
  agentSpeaking: boolean
  error: string | null
  start: (scenarioId: string) => Promise<void>
  /** Ringing only. Checks the microphone first; a refusal leaves the call ringing with an error and the ring timer paused. */
  accept: () => Promise<void>
  /** Ringing only. */
  decline: () => Promise<void>
  /** In call only. */
  hangUp: () => void
  /** Not while connecting or in a call. */
  reset: () => void
  /** Leaving the page mid-call: ends the voice session and resolves once the server has been told (best effort). */
  leave: () => Promise<void>
}

// Where this browser is with the server-side call; guards the actions without reading render state.
type Stage = 'starting' | 'ringing' | 'answering' | 'in_call' | 'analyzing' | 'done'

interface Session {
  abort: AbortController
  /** Aborted by `abort` or when the hook unmounts. */
  signal: AbortSignal
  stage: Stage
  callId: string | null
  conversationId: string | null
  /** The ElevenLabs session connected (onConnect fired). */
  connected: boolean
}

const BUSY: Stage[] = ['starting', 'answering', 'in_call', 'analyzing']

/**
 * One simulated scam call: ring → accept/decline → voice session → post-call analysis.
 *
 * Must be rendered below `<ConversationProvider>` from `@elevenlabs/react`, and that provider
 * must not unmount mid-call (unmounting it ends the voice session). Unmounting this hook
 * mid-call hangs up.
 */
export function useSimulatedCall({ ringTimeoutMs = 30_000 }: { ringTimeoutMs?: number } = {}): SimulatedCallHandle {
  const [state, dispatch] = useReducer(callReducer, INITIAL_CALL_STATE)
  const session = useRef<Session | null>(null)
  const lifetime = useRef<AbortController | null>(null)

  const reportEnded = useCallback(async (poll: boolean) => {
    const s = session.current
    if (!s?.callId || s.stage !== 'in_call') return
    const { callId } = s
    s.stage = poll ? 'analyzing' : 'done'
    if (poll) dispatch({ type: 'hung_up', callId })
    try {
      const record = await comms.callEnded(callId, s.conversationId ?? undefined, s.signal)
      if (!poll) return
      dispatch({ type: 'record', callId, record })
      await pollUntilCompleted(comms.getCall, callId, {
        signal: s.signal,
        onRecord: (next) => dispatch({ type: 'record', callId, record: next }),
      })
    } catch (error) {
      // Without polling this is a best-effort report after a failed start, which already shows its own error.
      if (poll && !isAbortError(error)) dispatch({ type: 'failed', callId, error: describeError(error), phase: 'error' })
    } finally {
      if (s.stage === 'analyzing') s.stage = 'done'
    }
  }, [])

  // The voice session never connected, but the server already marked the call in_call on accept.
  const failSession = useCallback((error: string) => {
    const s = session.current
    if (!s?.callId || s.stage !== 'in_call' || s.connected) return
    dispatch({ type: 'failed', callId: s.callId, error, phase: 'error' })
    void reportEnded(false)
  }, [reportEnded])

  // Callbacks are registered with the provider through stable wrappers that call the latest render's version.
  const { startSession, endSession, isSpeaking } = useConversation({
    onConnect: ({ conversationId }) => {
      const s = session.current
      if (!s?.callId || s.stage !== 'in_call') return
      const { callId } = s
      s.connected = true
      if (conversationId) s.conversationId = conversationId
      dispatch({ type: 'connected', callId })
      if (!conversationId) return
      // Binds the id if the token response had none. Other failures are fine: /ended carries the id too.
      comms.callConnected(callId, conversationId, s.signal).catch((error: unknown) => {
        if (!(error instanceof CommsError && error.code === 'conversation_mismatch') || s.stage !== 'in_call') return
        s.stage = 'done'
        endSession()
        dispatch({ type: 'failed', callId, error: error.code, phase: 'error' })
      })
    },
    onDisconnect: () => {
      const s = session.current
      if (s?.stage !== 'in_call') return
      if (s.connected) void reportEnded(true)
      else failSession('connection_failed')
    },
    onMessage: ({ role, message }) => {
      const s = session.current
      if (!s?.callId || s.stage !== 'in_call' || !message) return
      dispatch({ type: 'caption', callId: s.callId, caption: { role, message } })
    },
    onError: (message) => {
      const s = session.current
      if (!s?.callId || s.stage !== 'in_call') return
      if (s.connected) dispatch({ type: 'failed', callId: s.callId, error: message })
      else failSession(message)
    },
  })

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      controller.abort()
      const s = session.current
      if (!s) return
      s.abort.abort()
      if (s.callId && s.stage === 'in_call') {
        // Unmounted mid-call: our callbacks are gone, so hang up and report it here (best effort).
        s.stage = 'done'
        endSession()
        comms.callEnded(s.callId, s.conversationId ?? undefined).catch(() => {})
      }
    }
  }, [endSession])

  const start = useCallback(async (scenarioId: string) => {
    const prev = session.current
    if (prev && BUSY.includes(prev.stage)) return
    prev?.abort.abort()
    const abort = new AbortController()
    const s: Session = {
      abort,
      signal: lifetime.current ? AbortSignal.any([abort.signal, lifetime.current.signal]) : abort.signal,
      stage: 'starting',
      callId: null,
      conversationId: null,
      connected: false,
    }
    session.current = s
    dispatch({ type: 'start' })
    try {
      const { callId, callerLabel, call } = await comms.startCall(scenarioId, s.signal)
      if (session.current !== s) return
      s.callId = callId
      s.stage = 'ringing'
      dispatch({ type: 'ringing', callId, callerLabel, record: call })
    } catch (error) {
      if (session.current !== s || isAbortError(error)) return
      s.stage = 'done'
      dispatch({ type: 'failed', callId: null, error: describeError(error), phase: 'error' })
    }
  }, [])

  const accept = useCallback(async () => {
    const s = session.current
    if (!s?.callId || s.stage !== 'ringing') return
    const { callId } = s
    s.stage = 'answering'
    dispatch({ type: 'connecting', callId })

    // Ask for the mic before accepting: a refusal leaves the call ringing on the server.
    const blocker = microphoneBlocker({ secureContext: window.isSecureContext, getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia) })
    try {
      if (blocker) throw new Error(blocker)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
    } catch (error) {
      if (session.current !== s || s.signal.aborted) return
      s.stage = 'ringing'
      dispatch({ type: 'failed', callId, error: blocker ?? microphoneErrorCode(error), phase: 'ringing' })
      return
    }
    if (session.current !== s || s.signal.aborted) return

    try {
      const { conversationToken, conversationId, overrides } = await comms.acceptCall(callId, s.signal)
      if (session.current !== s) return
      s.stage = 'in_call'
      s.conversationId = conversationId ?? null
      startSession({ conversationToken, connectionType: 'webrtc', overrides })
    } catch (error) {
      if (session.current !== s || isAbortError(error)) return
      // 502/503: ElevenLabs is unavailable and the server left the call ringing.
      const ringing = error instanceof CommsError && (error.status === 502 || error.status === 503)
      s.stage = ringing ? 'ringing' : 'done'
      dispatch({ type: 'failed', callId, error: describeError(error), phase: ringing ? 'ringing' : 'error' })
    }
  }, [startSession])

  const declineAs = useCallback(async (reason: DeclineReason) => {
    const s = session.current
    if (!s?.callId || s.stage !== 'ringing') return
    const { callId } = s
    s.stage = 'done'
    try {
      const record = await comms.declineCall(callId, reason, s.signal)
      dispatch({ type: 'record', callId, record })
    } catch (error) {
      if (!isAbortError(error)) dispatch({ type: 'failed', callId, error: describeError(error), phase: 'error' })
    }
  }, [])

  const decline = useCallback(() => declineAs('declined'), [declineAs])

  // Paused while an error (microphone, voice service) is on screen, so the user isn't auto-missed while reading it.
  const ringPaused = Boolean(state.error)
  useEffect(() => {
    if (state.phase !== 'ringing' || ringPaused || ringTimeoutMs <= 0) return
    const timer = setTimeout(() => void declineAs('missed'), ringTimeoutMs)
    return () => clearTimeout(timer)
  }, [state.phase, state.callId, ringPaused, ringTimeoutMs, declineAs])

  const hangUp = useCallback(() => {
    const s = session.current
    if (s?.stage !== 'in_call' || !s.connected) return
    endSession()
    // onDisconnect follows; reportEnded only runs once.
    void reportEnded(true)
  }, [endSession, reportEnded])

  const reset = useCallback(() => {
    const s = session.current
    if (s?.stage === 'answering' || s?.stage === 'in_call') return
    s?.abort.abort()
    session.current = null
    dispatch({ type: 'reset' })
  }, [])

  const leave = useCallback(async () => {
    const s = session.current
    if (!s) return
    s.abort.abort()
    if (!s.callId || s.stage !== 'in_call') return
    s.stage = 'done'
    endSession()
    // Not tied to the aborted signal: this must reach the server before the page (or the session) goes away.
    await comms.callEnded(s.callId, s.conversationId ?? undefined).catch(() => {})
  }, [endSession])

  return {
    phase: state.phase,
    callId: state.callId,
    callerLabel: state.callerLabel,
    record: state.record,
    outcome: state.phase === 'completed' ? state.record?.outcome ?? null : null,
    captions: state.captions,
    agentSpeaking: state.phase === 'in_call' && isSpeaking,
    error: state.error,
    start,
    accept,
    decline,
    hangUp,
    reset,
    leave,
  }
}
