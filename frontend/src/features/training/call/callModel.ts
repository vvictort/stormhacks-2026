import type { CallPhase } from '../../../comms/callState.ts'
import type { CallTranscriptTurn } from '../../../comms/types.ts'
import { normalizeCommsOutcome, readCallResult, type CallResult } from '../callOutcome.ts'
import type { CallScenario } from '../scenarios.ts'

// Pure view logic for the call screen and the call debrief; no React, tested in Node.

export type CallScreen =
  | 'idle' | 'starting' | 'ringing' | 'connecting' | 'active' | 'analyzing'
  | 'ended' | 'declined' | 'missed'
  | 'mic_denied' | 'mic_unavailable' | 'insecure' | 'comms_unavailable' | 'voice_unavailable' | 'failed'

// The API unreachable or broken: fetch failed, a 5xx without a JSON body (a dev proxy with the API down answers 500),
// or the API's own 503 SERVICE_UNAVAILABLE (e.g. the database is down while looking up a generated scenario).
const COMMS_DOWN = /^(network_error|SERVICE_UNAVAILABLE|http_5\d\d)$/

/** Which screen the phone shows for a call-hook state. `result` comes from callOutcome only. */
export function callScreen({ phase, callId, error, result }: { phase: CallPhase; callId: string | null; error: string | null; result: CallResult | null }): CallScreen {
  switch (phase) {
    case 'idle': return 'idle'
    case 'starting': return 'starting'
    case 'connecting': return 'connecting'
    case 'in_call': return 'active'
    case 'analyzing': return 'analyzing'
    case 'completed': return result?.outcome === 'declined' ? 'declined' : result?.outcome === 'missed' ? 'missed' : 'ended'
    case 'ringing':
      if (error === 'microphone_denied') return 'mic_denied'
      if (error === 'microphone_unavailable') return 'mic_unavailable'
      if (error === 'insecure_context') return 'insecure'
      if (error?.startsWith('elevenlabs_')) return 'voice_unavailable'
      return 'ringing'
    case 'error':
      if (error?.startsWith('elevenlabs_')) return 'voice_unavailable'
      if (!callId && error && COMMS_DOWN.test(error)) return 'comms_unavailable'
      return 'failed'
  }
}

/** Live voice can't happen (or just failed): offer the caption-only practice mode instead. */
export const offersPractice = (screen: CallScreen) =>
  ['mic_denied', 'mic_unavailable', 'insecure', 'comms_unavailable', 'voice_unavailable', 'failed'].includes(screen)

/** A practice-mode choice, scored with the same contract table as a live call. */
export function practiceResult(action: 'hang_up' | 'comply' | 'decline'): CallResult {
  return normalizeCommsOutcome({ hang_up: 'resisted', comply: 'compromised', decline: 'declined' }[action])!
}

export const formatDuration = (secs: number) =>
  `${Math.floor(Math.max(0, secs) / 60)}:${String(Math.floor(Math.max(0, secs) % 60)).padStart(2, '0')}`

// ---------- Debrief ----------

export const tacticLabels: Record<string, string> = {
  urgency: 'Rushing you',
  authority: 'Posing as someone in charge',
  fear: 'Fear and threats',
  otp_request: 'Asking for a one-time code',
  info_request: 'Asking for personal details',
  reward: 'A reward that sounds too good',
  suspicious_link: 'A link to follow',
}

const signalLabels: Record<string, string> = {
  shared_code: 'You read out a code',
  shared_personal_info: 'You shared personal details',
  shared_payment_info: 'You shared payment details',
  agreed_to_action: 'You agreed to do what they asked',
  engaged: 'You talked with the caller',
  challenged: 'You questioned the caller',
  asked_to_verify: 'You asked to verify who was calling',
  reported: 'You called it out as a scam',
  stop: 'You told them to stop',
}

export interface DebriefSource {
  result: CallResult | null
  signals?: string[]
  tactics?: string[]
  /** Redacted, from the backend attempt or the comms record. Never live captions. */
  transcript?: CallTranscriptTurn[]
  /** Where the result came from: the backend attempt, the comms call record, or local practice mode. */
  from: 'attempt' | 'record' | 'practice'
}

export interface Moment { role: 'agent' | 'user'; message: string; time: string }

const PRESSURE = /\b(codes?|pay|payment|password|card|account|access|transfer|gift|minutes?|now|today|immediately|urgent|arrest|warrant|fee|download|install|scam|verify|call (you )?back)\b/i

/** A few turns worth replaying: the opener, then lines about codes, money, access or pressure, in call order. */
export function importantMoments(transcript: CallTranscriptTurn[] = [], max = 4): Moment[] {
  const picked = transcript.filter((turn, i) => turn.message?.trim() && ((i === 0 && turn.role === 'agent') || PRESSURE.test(turn.message)))
  return picked.slice(0, max).map((turn) => ({
    role: turn.role,
    message: turn.message.length > 220 ? `${turn.message.slice(0, 217).trimEnd()}…` : turn.message,
    time: formatDuration(turn.timeInCallSecs ?? 0),
  }))
}

const outcomeCopy = {
  resisted: { title: 'You kept yourself safe.', line: 'You ended the call without giving the caller what they wanted.' },
  declined: { title: 'Declining was a safe call.', line: "You didn't answer a call you weren't expecting. Every practice call is a scam, so that counts." },
  missed: { title: 'Letting it ring was safe.', line: "You didn't pick up. A call you never answer can't talk you into anything." },
  compromised: { title: "Not quite. Here's what the caller was after.", line: 'The caller got something they wanted this time. That is exactly what practice is for.' },
  error: { title: "We couldn't score this call.", line: "Something went wrong while checking the call, so it doesn't count either way." },
} as const

export function buildCallDebrief(scenario: CallScenario, source: DebriefSource) {
  const { result, signals = [], tactics = [] } = source
  const copy = outcomeCopy[result?.outcome ?? 'error']
  const tone = result?.success === true ? 'success' : result?.success === false ? 'missed' : 'unscored'
  const has = (signal: string) => signals.includes(signal)

  const didWell: string[] = []
  if (has('challenged')) didWell.push("You questioned the caller's story instead of going along with it.")
  if (has('asked_to_verify')) didWell.push('You asked how to check who was really calling.')
  if (has('reported') || has('stop')) didWell.push('You said no plainly. You never owe a caller politeness.')
  if (result?.outcome === 'declined') didWell.push("You didn't pick up a call you weren't expecting.")
  if (result?.outcome === 'missed') didWell.push('You let an unexpected call ring out.')
  if (result?.outcome === 'resisted' && didWell.length === 0) didWell.push('You hung up without sharing a code, payment or personal details.')

  const improve: string[] = []
  if (has('shared_code')) improve.push('You read out a code. A code is only for typing into a site you opened yourself, never for a caller.')
  if (has('shared_payment_info')) improve.push("You gave payment details on a call you didn't make.")
  if (has('shared_personal_info')) improve.push("You shared personal details with a caller you couldn't check.")
  if (has('agreed_to_action')) improve.push('You agreed to do what the caller asked. "I\'ll call you back" and hanging up is always allowed.')
  if (tone === 'success' && has('engaged') && !has('challenged') && !has('asked_to_verify')) improve.push('You stayed on the line a while. Hanging up sooner gives a scammer less to work with.')
  if (improve.length === 0) improve.push(scenario.nextTime)

  return {
    tone,
    title: copy.title,
    outcomeLine: copy.line,
    mood: tone === 'success' ? 'happy' as const : tone === 'missed' ? 'alert' as const : 'curious' as const,
    explanation: scenario.explanation,
    tactics: [...new Set([...scenario.tactics, ...tactics])].map((tactic) => tacticLabels[tactic]).filter(Boolean),
    warningSigns: scenario.indicators,
    detected: signals.map((signal) => signalLabels[signal]).filter(Boolean),
    moments: importantMoments(source.transcript),
    didWell,
    improve,
    practice: source.from === 'practice',
  }
}

export type CallDebriefView = ReturnType<typeof buildCallDebrief>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
const turns = (value: unknown) => (Array.isArray(value)
  ? value.filter((turn): turn is CallTranscriptTurn => isRecord(turn) && (turn.role === 'agent' || turn.role === 'user') && typeof turn.message === 'string')
  : [])

/** Debrief data from the backend attempt when there is one, else from the comms call record. */
export function debriefSource(attempt: unknown, record: unknown): DebriefSource {
  if (isRecord(attempt) && readCallResult(attempt)) {
    return { result: readCallResult(attempt), from: 'attempt', signals: strings(attempt.signals), tactics: strings(attempt.tactics), transcript: turns(attempt.transcript) }
  }
  const scenario = isRecord(record) && isRecord(record.scenario) ? record.scenario : {}
  return { result: readCallResult(record), from: 'record', signals: isRecord(record) ? strings(record.signals) : [], tactics: strings(scenario.tactics), transcript: isRecord(record) ? turns(record.transcript) : [] }
}
