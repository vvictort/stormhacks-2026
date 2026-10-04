// Local mock scenarios. Later these come from the scenario service; the shape stays the same.
import type { Tactic } from '../../comms/types.ts'
import { callScenarios } from './callScenarios.ts'
import { emailScenarios } from './emailScenarios.ts'

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

export const scenarios: Scenario[] = [
  {
    id: 'parcel-redelivery',
    type: 'sms',
    tactics: ['urgency', 'suspicious_link', 'info_request'],
    title: 'Parcel redelivery fee',
    summary: 'A courier says your parcel is stuck until you pay a small fee.',
    situation: "You've ordered a couple of things online this week.",
    difficulty: 'easy',
    correctAction: 'report',
    sender: '+1 (782) 555-0143',
    receivedAt: '2:14 PM',
    messages: [{
      text: 'Canada Post: We attempted to deliver your parcel. A $2.17 redelivery fee is required. Update your delivery information within 24 hours or your parcel will be returned to sender:',
      link: 'https://canadapost.ca-redelivery.info/update',
    }],
    indicators: [
      { quote: 'Canada Post:', title: 'A name anyone can type', detail: 'The text names Canada Post, but it came from an ordinary mobile number. Putting a company name at the start of a message costs a scammer nothing.' },
      { quote: '$2.17 redelivery fee', title: 'An unexpected fee', detail: "A small amount feels too minor to question. The fee isn't the goal; the card details you'd type in to pay it are." },
      { quote: 'within 24 hours', title: 'A deadline to rush you', detail: 'A countdown is there to make you act before you stop and check.' },
      { quote: 'https://canadapost.ca-redelivery.info/update', title: 'A look-alike web address', detail: 'Read the address up to the first single slash. The part just before it, ca-redelivery.info, is the site you would actually visit. "canadapost" is only a label in front of it.' },
    ],
    explanation: 'This is a delivery-fee scam. It borrows a trusted name, adds a small fee and a deadline, and sends you to a look-alike site to collect your card details.',
    nextTime: "When a text asks you to pay, don't use its link. Check the web address, or go to the courier's site yourself and look up your tracking number.",
  },
  {
    id: 'dental-reminder',
    type: 'sms',
    tactics: [],
    title: 'Appointment reminder',
    summary: "A clinic texts about tomorrow's appointment.",
    situation: 'You booked a cleaning at Maple Grove Dental last month.',
    difficulty: 'easy',
    correctAction: 'safe',
    sender: '(604) 555-0182',
    receivedAt: '9:02 AM',
    messages: [{
      text: 'Hi, this is Maple Grove Dental. Reminder: your cleaning with Dr. Okafor is tomorrow at 2:30 PM. Reply C to confirm, or call us at 604-555-0182 to reschedule.',
    }],
    indicators: [
      { quote: 'your cleaning with Dr. Okafor is tomorrow at 2:30 PM', title: 'It matches something you did', detail: 'You booked this appointment. A message about something you were expecting is a good sign.' },
      { quote: 'Reply C to confirm', title: 'Nothing to pay, no link to tap', detail: "It doesn't ask for money, a password or personal details. Replying with one letter gives nothing away." },
      { quote: '604-555-0182', title: 'A number you can check', detail: "The callback number is the same one the text came from, and you can compare it with the number on the clinic's booking confirmation." },
    ],
    explanation: 'Real reminders tend to look like this: you were expecting it, it asks for nothing sensitive, and you can check it on your own.',
    nextTime: "Being careful is never wrong. To tell real reminders apart, ask: was I expecting this, and does it ask for money, codes or personal details?",
  },
  {
    id: 'new-number',
    type: 'sms',
    tactics: ['urgency'],
    title: '"Hi Mum, new number"',
    summary: 'Someone says they are family, texting from a new phone.',
    situation: 'Your daughter is away for work this week.',
    difficulty: 'medium',
    correctAction: 'report',
    sender: '+1 (437) 555-0129',
    receivedAt: '7:48 PM',
    messages: [
      { text: "Hi Mum it's me, dropped my phone in the sink so this is my new number for now. Can you save it?" },
      { text: "Bit stuck actually. I have to pay a bill today and my banking app won't work on this phone. Could you send $480 by e-Transfer? I'll pay you back tomorrow" },
    ],
    indicators: [
      { quote: 'this is my new number', title: "A new number you can't verify", detail: 'Anyone can claim to be family from an unknown number. The old number still exists, and that is the one to check with.' },
      { quote: 'I have to pay a bill today', title: 'Pressure to act now', detail: 'A deadline today leaves no time to call someone and check.' },
      { quote: 'send $480 by e-Transfer', title: 'Money to a new contact', detail: "Sending money to a number you've never used before is very hard to undo once it's gone." },
      { quote: "my banking app won't work on this phone", title: 'A reason not to check', detail: "The story explains why they can't do it themselves, which also nudges you away from calling to confirm." },
    ],
    explanation: 'This is a family-emergency scam. It uses a believable story and a familiar tone to get money sent quickly to an account you have no way to check.',
    nextTime: 'Before sending money, call the person on the number you already have, or ask something only they would know.',
  },
  {
    id: 'bank-code',
    type: 'sms',
    tactics: [],
    title: 'Sign-in code from your bank',
    summary: 'Your bank texts a code while you sign in.',
    situation: "You're signing in to Harbourline Bank on your laptop, and the site says it has texted you a code.",
    difficulty: 'medium',
    correctAction: 'safe',
    sender: '55501',
    receivedAt: '11:26 AM',
    messages: [{
      text: 'Harbourline Bank: 482913 is your code to sign in on a new device. It expires in 10 minutes. We will never call or text to ask for this code.',
    }],
    indicators: [
      { quote: 'your code to sign in on a new device', title: 'It matches what you just did', detail: 'You started a sign-in a moment ago and the site said a code was on its way. The text is the expected next step.' },
      { quote: 'We will never call or text to ask for this code', title: 'It tells you to keep it', detail: 'A real code message warns you not to share it. You type it into the site you opened yourself, and give it to no one.' },
      { quote: 'It expires in 10 minutes', title: 'A time limit with no threat', detail: "Codes expire quickly by design. Nothing bad happens if it runs out; you'd simply ask for a new one." },
    ],
    explanation: "This one is genuine. You asked for the code, it arrived when the site said it would, and it doesn't ask you to reply, tap a link or pass it on.",
    nextTime: "A code you didn't ask for is a warning sign. A code you did ask for is fine, as long as it only goes into the site you opened yourself.",
  },
  {
    id: 'wrong-number',
    type: 'sms',
    tactics: ['reward'],
    title: 'A friendly wrong number',
    summary: 'A stranger texts the wrong person, then keeps chatting.',
    situation: "You don't recognise the number, and you don't know anyone called Linda.",
    difficulty: 'medium',
    correctAction: 'report',
    sender: '+1 (778) 555-0164',
    receivedAt: '6:05 PM',
    messages: [
      { text: 'Hi Linda, are we still on for dim sum on Saturday at 11?' },
      { text: "Oh, so sorry! Wrong number. You seem kind though. I'm Grace, I just moved to Vancouver and don't know many people here yet." },
      { text: 'My uncle taught me to trade crypto and I made 30% last month. Happy to show you how, it only takes $200 to start :)' },
    ],
    indicators: [
      { quote: 'Wrong number.', title: 'A mistake that keeps going', detail: "Most people who text the wrong number apologise and stop. Turning the slip into a friendly chat is a common way to start a long con." },
      { quote: "don't know many people here yet", title: 'Friendship, fast', detail: 'A lonely, likeable story invites you to keep replying. The trust built over the next few days is what the scam needs.' },
      { quote: 'I made 30% last month', title: 'Returns that sound too good', detail: 'Real investments rarely grow that fast. Big, easy gains are the bait.' },
      { quote: 'it only takes $200 to start', title: 'A small first step', detail: "The first amount is kept low so it feels safe. Later the 'platform' shows fake profits and asks for more." },
    ],
    explanation: "This is the opening of an investment scam. A harmless-looking wrong number becomes a friendship, then a 'sure thing' that ends with your money on a fake trading site.",
    nextTime: 'When a stranger from a wrong-number text brings up investing or money, stop replying and block the number.',
  },
  {
    id: 'fraud-alert',
    type: 'sms',
    tactics: ['authority', 'fear', 'info_request'],
    title: 'Card fraud alert',
    summary: 'Your bank asks about a large purchase you never made.',
    situation: 'You bank with Harbourline Bank and use its credit card most days.',
    difficulty: 'hard',
    correctAction: 'report',
    sender: '+1 (289) 555-0117',
    receivedAt: '8:41 AM',
    messages: [
      { text: 'Harbourline Bank Fraud Alert: Did you attempt a purchase of $1,249.99 at ELECTROHUB ONLINE? Reply YES or NO.' },
      { text: 'If this was not you, call our Fraud Department now at 1-833-555-0168. Please have your card number and online banking password ready to verify your identity.' },
    ],
    indicators: [
      { quote: 'Harbourline Bank Fraud Alert:', title: 'A bank name from an ordinary number', detail: "Anyone can type a bank's name. Real alerts usually come from the short code your bank always uses; this one came from a regular mobile number." },
      { quote: 'Reply YES or NO', title: 'A reply that proves you are real', detail: 'Any answer tells the sender your number is live and that you are worried, which makes the follow-up call easier to sell.' },
      { quote: 'call our Fraud Department now at 1-833-555-0168', title: 'Their number, not the one on your card', detail: 'The text gives you a number to call. A real bank is happy for you to call the number printed on the back of your card instead.' },
      { quote: 'online banking password', title: 'A request no bank makes', detail: 'Your bank will never ask for your password, by text or on the phone. Anyone who does is trying to get into your account.' },
    ],
    explanation: 'This is a fake fraud alert. A scary purchase gets you worried, then a call-back number puts you on the phone with someone who asks for your card and password.',
    nextTime: "If a text says your card was misused, don't reply or call the number in it. Call the number on the back of your card, or check your banking app yourself.",
  },
  {
    id: 'share-code',
    type: 'sms',
    tactics: ['otp_request'],
    title: '"Can you send me that code?"',
    summary: 'Someone from a group chat asks for a code sent to your phone.',
    situation: "You play in a casual Thursday soccer group. You don't have everyone's number saved.",
    difficulty: 'hard',
    correctAction: 'report',
    sender: '+1 (604) 555-0196',
    receivedAt: '4:17 PM',
    messages: [
      { text: "Hey! It's Sam from Thursday soccer. I'm moving the team chat to a new app and adding everyone's numbers." },
      { text: 'The app just texted you a 6-digit code by mistake. Can you send it to me so I can finish setting you up?' },
    ],
    indicators: [
      { quote: "It's Sam from Thursday soccer", title: 'A familiar name from an unknown number', detail: "Mentioning a group you really belong to makes the message feel safe. Names like this are easy to find in a shared chat or online." },
      { quote: 'texted you a 6-digit code by mistake', title: 'A code is never sent by mistake', detail: 'A sign-in code is sent to your phone because someone is trying to sign in as you. That person is the one asking.' },
      { quote: 'Can you send it to me', title: 'Asking you to pass on a code', detail: 'Codes are meant only for the person who owns the phone. Sharing one can hand over your messaging, email or bank account.' },
    ],
    explanation: "This is an account-takeover scam. The sender is signing in to an account linked to your number, and your code is the last thing they need.",
    nextTime: "Never pass on a code sent to your phone, even to someone you know. If the request seems real, check with them another way first.",
  },
  ...emailScenarios,
  ...callScenarios,
]

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
