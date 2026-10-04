import type { CallPhase } from '../../../comms/callState.ts'
import type { CallTranscriptTurn } from '../../../comms/types.ts'
import { normalizeCommsOutcome, readCallResult, type CallResult } from '../callOutcome.ts'
import type { CallScenario } from '../scenarios.ts'

// Pure view logic for the call screen and the call debrief; no React, tested in Node.

export type CallScreen =
  | 'idle' | 'starting' | 'ringing' | 'connecting' | 'active' | 'analyzing'
  | 'ended' | 'declined' | 'missed'
  | 'mic_denied' | 'mic_unavailable' | 'insecure' | 'comms_unavailable' | 'voice_unavailable' | 'not_connected' | 'failed'

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
      // The user cancelled a call stuck connecting, or it timed out (useSimulatedCall).
      if (error === 'connect_cancelled' || error === 'connect_timeout') return 'not_connected'
      if (!callId && error && COMMS_DOWN.test(error)) return 'comms_unavailable'
      return 'failed'
  }
}

/** Live voice can't happen (or just failed): offer the caption-only practice mode instead. */
export const offersPractice = (screen: CallScreen) =>
  ['mic_denied', 'mic_unavailable', 'insecure', 'comms_unavailable', 'voice_unavailable', 'not_connected', 'failed'].includes(screen)

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

/** What each tactic asked for, said as something the user held back on (a resisted call). */
const heldBack: Partial<Record<string, string>> = {
  otp_request: 'You kept the code to yourself.',
  info_request: "You didn't confirm your personal or card details.",
  reward: "You didn't pay to claim the “prize”.",
  suspicious_link: "You didn't open the link or install anything.",
  urgency: "You didn't let the deadline rush you.",
  fear: "You didn't let the scare push you into acting.",
}

/** The one thing to practise, most important first. */
const fixes: [signal: string, slip: string, advice: string][] = [
  ['shared_code', 'You read out a code', 'Never read out a code. A code is only for typing into a site or app you opened yourself, never for a caller.'],
  ['shared_payment_info', 'You shared payment details', "Never give card or payment details on a call you didn't make. Hang up and call the number on your card."],
  ['shared_personal_info', 'You shared personal details', 'Don’t "confirm" personal details for a caller. Say you’ll call back on a number you look up yourself.'],
  ['agreed_to_action', 'You agreed to do what they asked', 'When a caller asks you to act, say "I’ll call you back", hang up, and check on your own.'],
]

// A request for something the caller shouldn't get, and a reply that was starting to go along with it.
const ASK = /\b(codes?|pin|password|card|cvv|expiry|account (number|details)|date of birth|address|sin\b|social insurance|username|pay|payment|fee|transfer|gift cards?|install|link|remote|confirm)\b/i
const GIVING = /\[(number|email)|\b(ok(ay)?|sure|yes|yeah|yep|alright|let me (check|find|get|see)|hold on|one sec(ond)?|hang on|it'?s|here it is|i (got|have) it)\b/i
const REFUSING = /\b(no|nope|not|won'?t|don'?t|never|scam|hang(ing)? up|call (you |them |the bank |it )?back|verify|myself|bye)\b/i

const moment = (turn: CallTranscriptTurn): Moment => ({
  role: turn.role,
  message: turn.message.length > 220 ? `${turn.message.slice(0, 217).trimEnd()}…` : turn.message,
  time: formatDuration(turn.timeInCallSecs ?? 0),
})

/**
 * The caller's ask, and the user's reply when it was going along: for a compromised call, where it got through; for a
 * resisted one, where it nearly did. From the redacted transcript only.
 */
export function riskyExchange(transcript: CallTranscriptTurn[] = []) {
  let ask: CallTranscriptTurn | undefined
  for (const [i, turn] of transcript.entries()) {
    if (turn.role !== 'agent' || !ASK.test(turn.message ?? '')) continue
    ask ??= turn
    const reply = transcript.slice(i + 1).find((next) => next.role === 'user')
    if (reply && GIVING.test(reply.message) && (/\[(number|email)/i.test(reply.message) || !REFUSING.test(reply.message))) {
      return { ask: moment(turn), reply: moment(reply) }
    }
  }
  return ask ? { ask: moment(ask), reply: null } : null
}

export function buildCallDebrief(scenario: CallScenario, source: DebriefSource) {
  const { result, signals = [], tactics = [] } = source
  const copy = outcomeCopy[result?.outcome ?? 'error']
  const tone = result?.success === true ? 'success' : result?.success === false ? 'missed' : 'unscored'
  const has = (signal: string) => signals.includes(signal)
  const allTactics = [...new Set([...scenario.tactics, ...tactics])]
  const answered = result?.outcome === 'resisted' || result?.outcome === 'compromised'
  const exchange = answered ? riskyExchange(source.transcript) : null

  // What you resisted: what you did, then what you held back on.
  const didWell: string[] = []
  if (has('challenged')) didWell.push("You questioned the caller's story instead of going along with it.")
  if (has('asked_to_verify')) didWell.push('You said you would check who was really calling.')
  if (has('reported') || has('stop')) didWell.push('You said no plainly. You never owe a caller politeness.')
  if (result?.outcome === 'declined') didWell.push("You didn't pick up a call you weren't expecting.")
  if (result?.outcome === 'missed') didWell.push('You let an unexpected call ring out.')
  if (result?.outcome === 'resisted') {
    didWell.push(...allTactics.map((tactic) => heldBack[tactic]).filter((line): line is string => Boolean(line)).slice(0, 3))
    if (didWell.length === 0) didWell.push('You hung up without sharing a code, payment or personal details.')
  }

  // What you nearly fell for (resisted), or where the caller got through (compromised).
  const slips = fixes.filter(([signal]) => has(signal)).map(([, slip]) => slip)
  let nearMiss: { line: string; exchange: typeof exchange } | null = null
  if (result?.outcome === 'compromised') {
    nearMiss = {
      line: source.from === 'practice'
        ? `You chose "${scenario.practice.complyLabel}". That was exactly what the caller was after.`
        : slips.length ? `${slips.join('. ')}.` : 'You went along with what the caller asked.',
      exchange,
    }
  } else if (result?.outcome === 'resisted' && exchange?.reply) {
    nearMiss = { line: 'You started to go along here before you stopped. Notice the moment the caller asked for something.', exchange }
  }

  const fix = fixes.find(([signal]) => has(signal))?.[2]
  const lingered = tone === 'success' && has('engaged') && !has('challenged') && !has('asked_to_verify')
  const recommendation = fix ?? (lingered ? 'Hang up sooner. You stayed on the line a while, and every minute gives a scammer more to work with.' : scenario.nextTime)

  return {
    tone,
    title: copy.title,
    outcomeLine: copy.line,
    mood: tone === 'success' ? 'happy' as const : tone === 'missed' ? 'alert' as const : 'curious' as const,
    explanation: scenario.explanation,
    /** What the caller tried: the pretext, their tactics, and their ask from the transcript when there is one. */
    pretext: scenario.summary,
    answered,
    tactics: allTactics.map((tactic) => tacticLabels[tactic]).filter(Boolean),
    ask: exchange?.ask ?? null,
    warningSigns: scenario.indicators,
    // Lines already quoted above aren't repeated.
    moments: importantMoments(source.transcript).filter((m) => ![exchange?.ask, exchange?.reply].some((q) => q && q.time === m.time && q.message === m.message)),
    didWell,
    nearMiss,
    recommendation,
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
