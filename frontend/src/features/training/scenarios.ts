// The practice path's scenarios and the helpers the phone, debrief and progress share.
import type { Tactic } from '../../comms/types.ts'
import { genuineScenarios } from './genuineScenarios.ts'
// Built from the scam library by backend/scripts/build-practice.ts; rebuild there, never edit by hand.
import practice from './practice.json' with { type: 'json' }

export type Channel = 'sms' | 'email' | 'call'
export type Action = 'report' | 'safe'
export type Difficulty = 'easy' | 'medium' | 'hard'
/** backend/app/shared/vocabulary.ts ScamCategory. */
export type ScamCategory = 'banking' | 'government' | 'shipping' | 'account_security' | 'workplace' | 'promotional'

/** Set on scenarios the backend generated for this user (ids `gen-email-…`, `gen-sms-…`, `gen-call-…`). */
export interface GeneratedInfo {
  source: 'gemini' | 'fallback'
  /** Why this scenario, in plain words, e.g. "Matched to your work in software and a weak spot: account security". */
  reason: string
  /** Gemini wrote it from a prompt grounded in this many real-world scam-library examples. Never on built-in fallbacks. */
  grounding?: { exampleCount: number; source: 'scam-library' }
}

/** Something worth noticing. `quote` is the exact text it points at, so the debrief can mark it in the message. */
export interface Indicator {
  quote?: string
  title: string
  detail: string
}

export interface SmsMessage {
  text: string
  /** Shown after the text. Never rendered as a working link. */
  link?: string
}

interface ScenarioCore {
  id: string
  title: string
  /** One line for the home path. */
  summary: string
  /** What the learner knows going in. */
  situation: string
  difficulty: Difficulty
  /** Red flags for a scam, reassuring signs for a genuine message. */
  indicators: Indicator[]
  explanation: string
  /** What to check next time, shown when the call was wrong. */
  nextTime: string
  /** Built-in scenarios leave it out; the backend infers it from the id and title. */
  scamCategory?: ScamCategory
  /** Social-engineering tactics it uses; a genuine message has none. Sent with the finished attempt. */
  tactics?: Tactic[]
  generated?: GeneratedInfo
}

interface BaseScenario extends ScenarioCore {
  correctAction: Action
}

export interface SmsScenario extends BaseScenario {
  type: 'sms'
  sender: string
  receivedAt: string
  messages: SmsMessage[]
}

export interface EmailScenario extends BaseScenario {
  type: 'email'
  fromName: string
  fromAddress: string
  /** Where replies really go, when it differs from the sender. */
  replyTo?: string
  subject: string
  receivedAt: string
  /** Paragraphs. */
  body: string[]
  /** Shown under the body. Never rendered as working links. */
  links?: string[]
  /** File name only; it never opens. */
  attachment?: string
}

/**
 * A voiced scam call. Teaching metadata only: the caller's script is server-owned (comms), and every call is a scam.
 * Indicators here have no `quote`: there is no fixed text to mark.
 */
export interface CallScenario extends ScenarioCore {
  type: 'call'
  /** Shown before the call starts and in practice mode; the live call shows the server's label. */
  callerLabel: string
  /** Fictional number for the ringing screen. */
  callerNumber?: string
  tactics: Tactic[]
  /** Caption-only practice mode, used when live voice is unavailable. */
  practice: { lines: string[]; complyLabel: string }
}

/** Texts and emails: one message to judge with Looks safe / Report & block. */
export type MessageScenario = SmsScenario | EmailScenario
export type Scenario = MessageScenario | CallScenario

export const channels: { type: Channel; name: string; ready: boolean; blurb: string }[] = [
  { type: 'sms', name: 'Text messages', ready: true, blurb: 'Texts that land on the practice phone.' },
  { type: 'email', name: 'Email', ready: true, blurb: 'Phishing emails in a practice inbox, with sender details you can inspect.' },
  { type: 'call', name: 'Phone calls', ready: true, blurb: 'Voiced scam calls you can answer or hang up on, with captions.' },
]

const built = practice as unknown as { texts: SmsScenario[]; emails: EmailScenario[]; calls: CallScenario[] }
const levels: Difficulty[] = ['easy', 'medium', 'hard']

/** The practice path: the library-built scams and the genuine messages, easiest first within each channel. */
export const scenarios: Scenario[] = [...built.texts, ...genuineScenarios, ...built.emails, ...built.calls]
  .sort((a, b) => levels.indexOf(a.difficulty) - levels.indexOf(b.difficulty))

export function getScenario(id: string | undefined) {
  return scenarios.find((scenario) => scenario.id === id)
}

/** Whether the scenario has a link worth inspecting. Calls never do. */
export function hasLink(scenario: Scenario) {
  if (scenario.type === 'call') return false
  return scenario.type === 'sms' ? scenario.messages.some((message) => message.link) : Boolean(scenario.links?.length)
}

/** Every call is a scam; texts and emails say so with `correctAction`. */
export const isScam = (scenario: Scenario) => scenario.type === 'call' || scenario.correctAction === 'report'

/** Whether a channel's scenarios can be practised. */
export const channelReady = (channel: Channel) => channels.some((item) => item.type === channel && item.ready)

/** How the channel is named in copy: "text message", "email", "phone call". */
export const channelNoun: Record<Channel, string> = { sms: 'text message', email: 'email', call: 'phone call' }

export interface Segment {
  text: string
  /** 1-based indicator number when this piece of text is a marked clue. */
  mark?: number
}

/** Splits text into plain and marked pieces. Overlapping quotes keep the earliest. */
export function markText(text: string, indicators: Indicator[]): Segment[] {
  const hits = indicators
    .map((indicator, i) => ({ start: indicator.quote ? text.indexOf(indicator.quote) : -1, end: 0, mark: i + 1, quote: indicator.quote ?? '' }))
    .filter((hit) => hit.start >= 0)
    .map((hit) => ({ ...hit, end: hit.start + hit.quote.length }))
    .sort((a, b) => a.start - b.start)

  const segments: Segment[] = []
  let cursor = 0
  for (const hit of hits) {
    if (hit.start < cursor) continue
    if (hit.start > cursor) segments.push({ text: text.slice(cursor, hit.start) })
    segments.push({ text: hit.quote, mark: hit.mark })
    cursor = hit.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

/** The marker number of the indicator that quotes this exact text, if any. */
export function markFor(quote: string, indicators: Indicator[]) {
  const index = indicators.findIndex((indicator) => indicator.quote === quote)
  return index < 0 ? undefined : index + 1
}

/** The site a link really goes to: the last two parts of its host name. */
// ponytail: naive for two-part suffixes like .co.uk; use a public-suffix list if scenarios need them.
export function siteOf(url: string) {
  try {
    return new URL(url).hostname.split('.').slice(-2).join('.')
  } catch {
    return url
  }
}
