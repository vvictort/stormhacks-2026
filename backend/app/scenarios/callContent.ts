import type { ScamCategory, Tactic } from "../shared/vocabulary.ts";

// The plain-language teaching copy the browser shows around a generated call, and the invented callers built-in calls
// use. Every company, person and number here is invented.

/** What the browser shows around a generated call (the frontend `CallScenario` teaching fields). Never the prompt. */
export interface CallTeaching {
  summary: string;
  situation: string;
  explanation: string;
  nextTime: string;
  callerNumber?: string;
  practice: { lines: string[]; complyLabel: string };
}

/** Invented callers, one per category: built-in calls present themselves as these, whatever the scam pattern claimed. */
export const CALLERS: Record<
  ScamCategory,
  { label: string; number: string; person: string }
> = {
  banking: {
    label: "Northshore Credit Union",
    number: "+1 (877) 555-0162",
    person: "Priya",
  },
  government: {
    label: "Federal Benefits Office",
    number: "+1 (613) 555-0119",
    person: "Officer Grant",
  },
  shipping: {
    label: "Apex Express Logistics",
    number: "+1 (604) 555-0131",
    person: "Marcus",
  },
  account_security: {
    label: "Cloudvault Security",
    number: "+1 (888) 555-0174",
    person: "Jordan",
  },
  workplace: {
    label: "IT Service Desk",
    number: "+1 (604) 555-0158",
    person: "Sarah",
  },
  promotional: {
    label: "Lumen Rewards Club",
    number: "+1 (855) 555-0193",
    person: "Tasha",
  },
};

/** The one hand-written call pattern, used only when the library has nothing for the category (or is missing). */
export const LAST_RESORT_PATTERN = {
  steps: [
    "says there is an urgent problem with your account",
    "asks for personal information",
    "pushes for action right away",
  ],
  tactics: ["authority", "urgency", "info_request"] as Tactic[],
};

export const GENERIC_NEXT_TIME =
  "Hang up and call the organisation back on a number you already trust, like the one on your card or its official website.";

/** Plain-language warning signs, one per tactic. Call indicators have no `quote`: there's no fixed text to mark. */
export const TACTIC_INDICATORS: Record<
  Tactic,
  { title: string; detail: string }
> = {
  urgency: {
    title: "A deadline on the phone",
    detail:
      "The caller says it has to happen right now. Real organisations give you time to hang up and check; a rush is there to stop you thinking.",
  },
  authority: {
    title: 'Someone "official" on the line',
    detail:
      "Anyone can say they're from your bank, IT or the government. Authority on a call you didn't make proves nothing.",
  },
  fear: {
    title: "Something scary to keep you talking",
    detail:
      "A hacked account, a frozen card, a warrant: fear makes you want to fix it right away, with the caller's help.",
  },
  otp_request: {
    title: "Asking you to read out a code",
    detail:
      "A one-time code is only for typing into a site or app you opened yourself. Anyone who asks you to read one out is trying to get in as you.",
  },
  info_request: {
    title: 'Asking you to "confirm" details',
    detail:
      "A real organisation already has your details. Reading out your card, address or ID number hands them to a stranger.",
  },
  reward: {
    title: "A prize out of nowhere",
    detail:
      "If you didn't enter, you didn't win. A small fee or your card details to claim it is the scam.",
  },
  suspicious_link: {
    title: "A link or app to open",
    detail:
      "Being told to open a link or install something during the call gives the caller a way into your device or accounts.",
  },
};

export const CALLER_ID_INDICATOR = {
  title: "A name on the screen proves nothing",
  detail:
    "Caller ID can be faked. A familiar name on your phone doesn't mean that organisation is on the line.",
};

/** Caption-practice follow-ups for a Gemini-written call, after its opening line. */
export const TACTIC_LINES: Partial<Record<Tactic, string>> = {
  fear: "If we don’t sort this out now, you could lose access, or the money, for good.",
  info_request:
    "Before we go on, can you confirm your full name, date of birth and home address?",
  otp_request:
    "I've just sent a six-digit code to your phone. Can you read it back to me?",
  reward:
    "The good news is you qualify. I just need a card for the small processing fee.",
  suspicious_link:
    "I'm texting you a secure link now. Open it and sign in so we can confirm it's you.",
  urgency: "Please be quick, this has to be done in the next few minutes.",
};

export const COMPLY_LABELS: Partial<Record<Tactic, string>> = {
  otp_request: "Read out the code",
  info_request: "Give your details",
  suspicious_link: "Open the link",
  reward: "Pay the fee",
};

/** How the caller behaves at each difficulty, appended to the scenario prompt. */
export const DIFFICULTY_STYLE = {
  1: "Difficulty: beginner. Make a few small slips a careful person could notice (vague details, a slightly odd phrase), and give up politely after being challenged twice.",
  2: "Difficulty: intermediate. Sound convincing and keep a steady, polite pressure. Have one plausible answer ready for each objection before giving up.",
  3: "Difficulty: advanced. Sound fully professional and calm, use realistic reference numbers and procedure, and handle objections smoothly. Never sound pushy, and keep trying other angles until the person firmly refuses.",
} as const;

export const CATEGORY_NAMES: Record<ScamCategory, string> = {
  banking: "bank and card",
  government: "government",
  shipping: "delivery",
  account_security: "account security",
  workplace: "workplace",
  promotional: "prize and offer",
};
