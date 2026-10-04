// Mirror of backend/app/shared/types.ts and the /api/comms route responses. Keep in sync by hand.

export type Channel = 'text' | 'call'

export type Tactic =
  | 'urgency'
  | 'authority'
  | 'suspicious_link'
  | 'otp_request'
  | 'info_request'
  | 'reward'
  | 'fear'

/** Observed user behaviours. */
export type Signal =
  | 'clicked_link'
  | 'shared_code'
  | 'shared_personal_info'
  | 'shared_payment_info'
  | 'agreed_to_action'
  | 'engaged'
  | 'challenged'
  | 'asked_to_verify'
  | 'reported'
  | 'stop'

export type Outcome =
  | 'compromised'
  | 'resisted'
  | 'reported'
  | 'ignored'
  | 'declined'
  | 'missed'
  | 'error'

export type Difficulty = 1 | 2 | 3

interface ScenarioBase {
  id: string
  title: string
  tactics: Tactic[]
  difficulty: Difficulty
}

export interface TextScenario extends ScenarioBase {
  /** Shown as the sender in the fake messaging UI (a name or a fake number). */
  senderLabel: string
  /** First scam text. `{{link}}` is replaced with `linkDisplayUrl` and made tappable. */
  openingMessage: string
  linkDisplayUrl?: string
  persona: string
  maxTurns: number
}

export interface CallScenario extends ScenarioBase {
  /** Shown on the ringing screen (a name or a fake number). */
  callerLabel: string
  systemPrompt: string
  firstMessage: string
  voiceId?: string
}

/** `GET /api/comms/scenarios` entry. */
export interface ScenarioSummary {
  id: string
  channel: Channel
  title: string
  tactics: Tactic[]
  difficulty: Difficulty
  label: string
}

export interface TextLink {
  text: string
  href: string
}

export interface TextMessage {
  id: string
  from: 'scammer' | 'user'
  /** User messages are redacted before they are stored. */
  body: string
  at: string
  links?: TextLink[]
  /** User messages: ms since the previous scammer message. */
  latencyMs?: number
  /** User messages: rule-based signals detected in this message. */
  signals?: Signal[]
  /** Scammer messages: true for an unprompted nudge after silence. */
  followUp?: boolean
}

export type ThreadEndReason =
  'provider_done' | 'max_turns' | 'reported' | 'link_clicked' | 'idle'

export interface TextThread {
  id: string
  userId: string
  scenario: TextScenario
  status: 'active' | 'ended'
  outcome?: Outcome
  endReason?: ThreadEndReason
  messages: TextMessage[]
  signals: Signal[]
  scammerTurns: number
  userMessagesHandled: number
  linkToken?: string
  linkFirstSentAt?: string
  firstClickAt?: string
  followUpSentAt?: string
  createdAt: string
  endedAt?: string
}

export type CallStatus = 'ringing' | 'in_call' | 'analyzing' | 'completed'

export interface CallTranscriptTurn {
  role: 'agent' | 'user'
  /** Redacted. */
  message: string
  timeInCallSecs: number
}

/** Canonical training result vocabulary (docs/call-integration.md). */
export type TrainingOutcome =
  'resisted' | 'compromised' | 'declined' | 'missed' | 'error'

/** Comms' normalised result on a completed call: `success` is null when the call isn't scored. */
export interface CallTraining {
  outcome: TrainingOutcome
  success: boolean | null
  difficulty: 'easy' | 'medium' | 'hard'
}

export interface CallRecord {
  id: string
  userId: string
  scenario: CallScenario
  status: CallStatus
  outcome?: Outcome
  conversationId?: string
  createdAt: string
  acceptedAt?: string
  endedAt?: string
  completedAt?: string
  durationSecs?: number
  /** Redacted. */
  summary?: string
  transcript?: CallTranscriptTurn[]
  dataCollection?: Record<string, { value: unknown; rationale?: string }>
  /** ElevenLabs `user_resisted` evaluation result. */
  resisted?: string
  signals: Signal[]
  /** Canonical outcome, set once the call is completed. The UI reads results from here, never from `outcome`. */
  training?: CallTraining
  error?: string
}

/** Session overrides in the shape `@elevenlabs/react` `startSession` expects. */
export interface CallOverrides {
  agent: { prompt: { prompt: string }; firstMessage: string }
  tts?: { voiceId: string }
}

/** Body of `POST /api/comms/texts`; an empty pick means a random scenario. Scenarios are server-owned: ids only. */
export interface ScenarioPick {
  scenarioId?: string
}

/** `POST /api/comms/texts` 201 response. */
export interface StartTextResponse {
  threadId: string
  streamUrl: string
  thread: TextThread
}

/** Client-side result of starting a text: `resumed` when the user already had an active thread. */
export interface StartTextResult {
  threadId: string
  resumed: boolean
}

/** `POST /api/comms/calls` 201 response. */
export interface StartCallResponse {
  callId: string
  callerLabel: string
  call: CallRecord
}

/** `POST /api/comms/calls/:id/accept` response. */
export interface AcceptCallResponse {
  conversationToken: string
  /** Omitted if ElevenLabs didn't return one with the token. */
  conversationId?: string
  overrides: CallOverrides
}

export type DeclineReason = 'declined' | 'missed'
