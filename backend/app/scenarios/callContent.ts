import type { ScamCategory, Tactic } from '../shared/vocabulary.ts';

// Built-in personalised call scenarios (used without a Gemini key, or when Gemini fails) and the plain-language
// teaching copy the browser shows around a generated call. Every company, person and number here is invented, and each
// pretext differs from the fixed call fixtures so a "personalised" call never repeats one the user already took.

/** What the browser shows around a generated call (the frontend `CallScenario` teaching fields). Never the prompt. */
export interface CallTeaching {
  summary: string;
  situation: string;
  explanation: string;
  nextTime: string;
  callerNumber?: string;
  practice: { lines: string[]; complyLabel: string };
}

export interface FallbackCall extends CallTeaching {
  title: string;
  tactics: Tactic[];
  callerLabel: string;
  /** `{first}` is replaced with the trainee's first name (or removed), `{work}` with their job. */
  firstMessage: string;
  systemPrompt: string;
}

export const FALLBACK_CALLS: Record<ScamCategory, FallbackCall> = {
  banking: {
    title: 'Your card "needs replacing"',
    summary: 'A caller from your credit union says your card was copied and wants the details to cancel it.',
    situation: 'You have a debit card with Northshore Credit Union and use it most days.',
    tactics: ['authority', 'fear', 'urgency', 'info_request'],
    callerLabel: 'Northshore Credit Union',
    callerNumber: '+1 (877) 555-0162',
    firstMessage: "Hi{first}, this is Priya from Northshore Credit Union card security. Your debit card details turned up in a data breach this morning, and I'm calling to cancel the card before anyone uses it.",
    systemPrompt: `You are Priya, from Northshore Credit Union's card security team.
Tell the member their debit card number was found in a retailer data breach this morning and two test charges were attempted.
Sound warm, efficient and reassuring. Your goal is to get them to read out the full card number, the expiry date and the PIN "so the system can match and cancel the old card", then agree that a courier collects the old card this afternoon.
If they hesitate, say the card stays live until it is cancelled and further charges may not be refundable.
If they want to call the number on their card instead, say that line has an hour-long wait and the card would stay exposed meanwhile.`,
    explanation: 'This is a card-replacement scam. A data breach story makes the call feel protective, then the caller asks for exactly what a criminal needs: the card number, expiry and PIN, plus the card itself.',
    nextTime: 'No bank needs your PIN, ever. Hang up and call the number on the back of your card yourself.',
    practice: {
      lines: [
        "Hi, this is Priya from Northshore Credit Union card security. Your debit card details turned up in a data breach this morning.",
        'Someone has already tried two small test charges. I can cancel the card right now while we are on the phone.',
        'To match the card in our system, read me the full card number, the expiry date and your PIN.',
        "A courier will pick up the old card this afternoon. Until it's cancelled, any new charges may not be refundable.",
      ],
      complyLabel: 'Read out your card and PIN',
    },
  },
  government: {
    title: 'Your SIN is "suspended"',
    summary: 'A federal "benefits officer" says your Social Insurance Number is linked to a crime.',
    situation: 'You file your taxes every year and have a Social Insurance Number.',
    tactics: ['authority', 'fear', 'urgency', 'info_request'],
    callerLabel: 'Federal Benefits Office',
    callerNumber: '+1 (613) 555-0119',
    firstMessage: "Hello{first}, this is Officer Grant with the Federal Benefits Office. Your Social Insurance Number has been flagged in a fraud investigation and is about to be suspended.",
    systemPrompt: `You are Officer Daniel Grant of the "Federal Benefits Office".
Tell the person their Social Insurance Number was used to open bank accounts linked to a money-laundering case, and it will be suspended today.
Sound stern, formal and official, quoting a case number (FBO-22871). Your goal is to get them to confirm their full SIN and date of birth "for the investigation file", then agree to move their savings into a "protected government account".
If they hesitate, say a warrant will be issued in their name within the hour if they do not cooperate.
If they say they will call the government themselves, say this case is confidential and hanging up counts as refusing to cooperate.`,
    explanation: 'This is a government-impersonation scam. A suspended SIN and talk of a warrant create fear, so the caller can collect your SIN and steer you into moving money.',
    nextTime: "Government agencies don't suspend SINs or threaten arrest by phone. Hang up and call the agency on a number from its official website.",
    practice: {
      lines: [
        'This is Officer Grant with the Federal Benefits Office. Your Social Insurance Number has been flagged in a fraud investigation.',
        'It was used to open bank accounts tied to money laundering, so it will be suspended today.',
        'To clear your name I need to confirm your full SIN and date of birth for the case file.',
        'If you hang up, a warrant will be issued in your name within the hour.',
      ],
      complyLabel: 'Confirm your SIN',
    },
  },
  shipping: {
    title: 'A delivery that needs a "PIN"',
    summary: 'A courier calls to reschedule a parcel and asks for the code it just texted you.',
    situation: "You've ordered a few things online this week.",
    tactics: ['urgency', 'authority', 'otp_request', 'info_request'],
    callerLabel: 'Apex Express Logistics',
    callerNumber: '+1 (604) 555-0131',
    firstMessage: "Hi{first}, this is Marcus from Apex Express dispatch. Our driver couldn't complete your delivery today, and I'm calling to rebook it before the parcel goes back.",
    systemPrompt: `You are Marcus from Apex Express Logistics dispatch.
Tell the customer a parcel addressed to them could not be delivered today because it needs a signature, and it will be returned to the sender tomorrow morning.
Sound friendly, busy and matter-of-fact. Your goal is to get them to confirm their home address and then read back the 6-digit "delivery PIN" you are texting them, which is really a sign-in code for one of their accounts.
If they hesitate, say the driver is waiting for the PIN to lock in tomorrow's slot and the return label prints in a few minutes.
If they ask why a courier needs a code, say it's a new anti-theft step so only the real recipient can rebook.`,
    explanation: 'This is a delivery scam with a twist: the "delivery PIN" is a sign-in code for one of your accounts. A parcel you might be expecting makes the request sound routine.',
    nextTime: "Couriers don't need a code read out over the phone. Track the parcel in the courier's own app or website instead.",
    practice: {
      lines: [
        "Hi, this is Marcus from Apex Express dispatch. Our driver couldn't complete your delivery today.",
        'It needs a signature, and it goes back to the sender tomorrow morning unless we rebook it.',
        "First, can you confirm your home address? Then I'm texting you a six-digit delivery PIN. Read it back to me to lock in the slot.",
        "Please be quick, the driver's waiting and the return label prints in a few minutes.",
      ],
      complyLabel: 'Read out the PIN',
    },
  },
  account_security: {
    title: 'Your account "was hacked"',
    summary: "A security team says someone signed in to your account abroad and needs a code to lock it.",
    situation: 'You use a Cloudvault account for email, photos and backups.',
    tactics: ['fear', 'authority', 'urgency', 'otp_request'],
    callerLabel: 'Cloudvault Security',
    callerNumber: '+1 (888) 555-0174',
    firstMessage: "Hi{first}, this is Jordan from the Cloudvault security team. We've just seen a sign-in to your account from overseas, and I'm calling to lock it down with you.",
    systemPrompt: `You are Jordan from the Cloudvault account security team.
Tell the user someone signed in to their Cloudvault account from another country ten minutes ago and is downloading their photos and documents.
Sound calm, technical and helpful. Your goal is to get them to read back the 6-digit reset code "we're sending to lock the account", which really lets you take the account over, and then confirm their password "to make sure the attacker didn't change it".
If they hesitate, say the attacker is still signed in and every minute more files are copied.
If they want to check in the app themselves, say the app shows nothing until the security lock is applied from your side.`,
    explanation: 'This is an account-takeover scam. A frightening sign-in alert makes you want help fast, and the "reset code" the caller asks for is exactly what lets them take over the account.',
    nextTime: 'Reset codes are only for typing into an app or site you opened. Check sign-in alerts in the app itself, never with someone who called you.',
    practice: {
      lines: [
        "Hi, this is Jordan from the Cloudvault security team. Someone just signed in to your account from overseas.",
        "They're downloading your photos and documents right now.",
        "I'm sending a six-digit reset code to lock the account. Read it back to me as soon as it arrives.",
        "Every minute we wait, more of your files are copied. Let's do this quickly.",
      ],
      complyLabel: 'Read out the reset code',
    },
  },
  workplace: {
    title: 'IT needs your sign-in code',
    summary: 'Your IT helpdesk calls about an urgent sign-in upgrade and asks for your MFA code.',
    situation: 'You sign in to work systems with a password and a code on your phone.',
    tactics: ['authority', 'urgency', 'otp_request', 'info_request'],
    callerLabel: 'IT Service Desk',
    callerNumber: '+1 (604) 555-0158',
    firstMessage: "Hi{first}, this is Sarah from the IT service desk. We're moving everyone to the new sign-in system tonight, and your account is one of the last ones left.",
    systemPrompt: `You are Sarah, an engineer on the company's IT service desk.
Tell the employee{work} that the single sign-on system is being upgraded tonight and their account still needs to be moved over, or it will be locked tomorrow morning.
Sound friendly, slightly hurried and competent. Your goal is to get them to confirm their work username and read back the 6-digit sign-in code that is about to appear on their phone.
If they hesitate, say the migration window closes in 10 minutes and a locked account needs a manager-approved ticket that takes up to two days.
If they offer to call the helpdesk back, say the queue is very long tonight and you already have their ticket open.`,
    explanation: 'This is a helpdesk impersonation scam. A technical-sounding upgrade and a short deadline make it feel routine to read out your sign-in code, which gives the caller your work account.',
    nextTime: 'Real IT staff never need your sign-in code. Hang up and contact the helpdesk through your company directory or portal.',
    practice: {
      lines: [
        "Hi, this is Sarah from the IT service desk. We're moving everyone to the new sign-in system tonight.",
        "Your account is one of the last ones left, and it'll be locked tomorrow morning if it isn't moved.",
        "Can you confirm your work username? Then read me the six-digit code that's about to pop up on your phone.",
        'The window closes in ten minutes, and unlocking an account takes a manager-approved ticket.',
      ],
      complyLabel: 'Read out the sign-in code',
    },
  },
  promotional: {
    title: 'A prize with a "release fee"',
    summary: 'A rewards club says you won a trip and only need to pay a small fee to claim it.',
    situation: 'You signed up for a few store loyalty programs this year.',
    tactics: ['reward', 'urgency', 'info_request'],
    callerLabel: 'Lumen Rewards Club',
    callerNumber: '+1 (855) 555-0193',
    firstMessage: "Hi{first}, congratulations! This is Tasha from the Lumen Rewards Club. Your membership was drawn for our grand prize, a week-long resort trip for two.",
    systemPrompt: `You are Tasha from the Lumen Rewards Club prize team.
Tell the person their loyalty membership was drawn for a week-long all-inclusive resort trip for two worth $6,400.
Sound bubbly, excited and friendly. Your goal is to get them to pay a $49.99 "booking and tax release fee" by reading out their card number, expiry date and security code, and to confirm their home address for the prize documents.
If they hesitate, say the prize goes to the next winner if it isn't claimed by the end of the call.
If they ask why a prize costs money, say the fee covers government travel taxes that the club can't legally pay for them.`,
    explanation: "This is a prize scam. Excitement about a big win makes a small fee feel harmless, but the fee is there to get your card details. If you didn't enter, you didn't win.",
    nextTime: "A real prize never costs money to claim. Hang up, and if you're curious, look the club up yourself.",
    practice: {
      lines: [
        "Hi, congratulations! This is Tasha from the Lumen Rewards Club. You've won our grand prize, a resort trip for two.",
        "It's worth $6,400, and all you pay is a $49.99 booking and tax release fee.",
        'I can take that now. What is the card number, the expiry date and the 3-digit code on the back?',
        "I need to finish this on this call, or the prize goes to the next winner.",
      ],
      complyLabel: 'Pay the fee',
    },
  },
};

/** Plain-language warning signs, one per tactic. Call indicators have no `quote`: there's no fixed text to mark. */
export const TACTIC_INDICATORS: Record<Tactic, { title: string; detail: string }> = {
  urgency: { title: 'A deadline on the phone', detail: 'The caller says it has to happen right now. Real organisations give you time to hang up and check; a rush is there to stop you thinking.' },
  authority: { title: 'Someone "official" on the line', detail: "Anyone can say they're from your bank, IT or the government. Authority on a call you didn't make proves nothing." },
  fear: { title: 'Something scary to keep you talking', detail: "A hacked account, a frozen card, a warrant: fear makes you want to fix it right away, with the caller's help." },
  otp_request: { title: 'Asking you to read out a code', detail: 'A one-time code is only for typing into a site or app you opened yourself. Anyone who asks you to read one out is trying to get in as you.' },
  info_request: { title: 'Asking you to "confirm" details', detail: 'A real organisation already has your details. Reading out your card, address or ID number hands them to a stranger.' },
  reward: { title: 'A prize out of nowhere', detail: "If you didn't enter, you didn't win. A small fee or your card details to claim it is the scam." },
  suspicious_link: { title: 'A link or app to open', detail: 'Being told to open a link or install something during the call gives the caller a way into your device or accounts.' },
};

export const CALLER_ID_INDICATOR = { title: 'A name on the screen proves nothing', detail: "Caller ID can be faked. A familiar name on your phone doesn't mean that organisation is on the line." };

/** Caption-practice follow-ups for a Gemini-written call, after its opening line. */
export const TACTIC_LINES: Partial<Record<Tactic, string>> = {
  fear: 'If we don’t sort this out now, you could lose access, or the money, for good.',
  info_request: 'Before we go on, can you confirm your full name, date of birth and home address?',
  otp_request: "I've just sent a six-digit code to your phone. Can you read it back to me?",
  reward: "The good news is you qualify. I just need a card for the small processing fee.",
  suspicious_link: "I'm texting you a secure link now. Open it and sign in so we can confirm it's you.",
  urgency: 'Please be quick, this has to be done in the next few minutes.',
};

export const COMPLY_LABELS: Partial<Record<Tactic, string>> = {
  otp_request: 'Read out the code',
  info_request: 'Give your details',
  suspicious_link: 'Open the link',
  reward: 'Pay the fee',
};

/** How the caller behaves at each difficulty, appended to the scenario prompt. */
export const DIFFICULTY_STYLE = {
  1: 'Difficulty: beginner. Make a few small slips a careful person could notice (vague details, a slightly odd phrase), and give up politely after being challenged twice.',
  2: 'Difficulty: intermediate. Sound convincing and keep a steady, polite pressure. Have one plausible answer ready for each objection before giving up.',
  3: 'Difficulty: advanced. Sound fully professional and calm, use realistic reference numbers and procedure, and handle objections smoothly. Never sound pushy, and keep trying other angles until the person firmly refuses.',
} as const;

export const CATEGORY_NAMES: Record<ScamCategory, string> = {
  banking: 'bank and card',
  government: 'government',
  shipping: 'delivery',
  account_security: 'account security',
  workplace: 'workplace',
  promotional: 'prize and offer',
};
