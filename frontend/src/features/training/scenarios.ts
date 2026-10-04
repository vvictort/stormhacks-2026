// Local mock scenarios. Later these come from the scenario service; the shape stays the same.
import { emailScenarios } from './emailScenarios.ts'

export type Channel = 'sms' | 'email' | 'call'
export type Action = 'report' | 'safe'
export type Difficulty = 'easy' | 'medium' | 'hard'

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

interface BaseScenario {
  id: string
  title: string
  /** One line for the home path. */
  summary: string
  /** What the learner knows going in. */
  situation: string
  difficulty: Difficulty
  correctAction: Action
  /** Red flags for a scam, reassuring signs for a genuine message. */
  indicators: Indicator[]
  explanation: string
  /** What to check next time, shown when the call was wrong. */
  nextTime: string
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

// Add CallScenario here, plus a renderer in PhoneSimulator, when that channel lands.
export type Scenario = SmsScenario | EmailScenario

export const channels: { type: Channel; name: string; ready: boolean; blurb: string }[] = [
  { type: 'sms', name: 'Text messages', ready: true, blurb: 'Texts that land on the practice phone.' },
  { type: 'email', name: 'Email', ready: true, blurb: 'Phishing emails in a practice inbox, with sender details you can inspect.' },
  { type: 'call', name: 'Phone calls', ready: false, blurb: 'Voiced scam calls you can answer or hang up on, with captions.' },
]

export const scenarios: Scenario[] = [
  {
    id: 'parcel-redelivery',
    type: 'sms',
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
  ...emailScenarios,
]

export function getScenario(id: string | undefined) {
  return scenarios.find((scenario) => scenario.id === id)
}

/** Whether the scenario has a link worth inspecting. */
export function hasLink(scenario: Scenario) {
  return scenario.type === 'sms' ? scenario.messages.some((message) => message.link) : Boolean(scenario.links?.length)
}

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
