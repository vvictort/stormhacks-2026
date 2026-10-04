import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CallScenario, TextScenario } from "../shared/types.ts";
import { Difficulty, ScamCategory, Tactic } from "../shared/vocabulary.ts";
import {
  categoryBrief,
  emailFromExample,
  hiddenIndicators,
  repairQuote,
  toScenario,
} from "./email-generator.ts";
import { generateChecked, parseModelJson, type JsonModel } from "./gemini.ts";
import {
  patternCall,
  patternSteps,
  trainingCallScenario,
} from "./generator.ts";
import {
  blockedBrand,
  groundingBlock,
  type LibraryExample,
  type ScamLibrary,
} from "./library.ts";

// The practice path. Every scam in it comes from the scam library: emails are real phishing emails rewritten with
// invented names, calls follow real scam-call patterns, and texts were written by Gemini from library examples.
// scripts/build-practice.ts writes the files; tests check they match what this module builds.

export const PRACTICE_FILE = fileURLToPath(
  new URL(
    "../../../frontend/src/features/training/practice.json",
    import.meta.url,
  ),
);
export const FIXTURE_DIR = fileURLToPath(
  new URL("../../fixtures/scenarios/", import.meta.url),
);

/**
 * The library rows behind each practice slot, hand-picked for being clean, on-topic and readable (automatic ranking
 * kept surfacing junk such as pharmacy spam or advance-fee letters filed under the wrong type). Picking is the only
 * human step: every word of each scam still comes from the dataset. A row that stops building fails the tests.
 */
const EMAILS: [ScamCategory, Difficulty, string][] = [
  ["promotional", "easy", "email-a6b654ddfb30"],
  ["shipping", "easy", "email-335264f4a81e"],
  ["banking", "medium", "email-b2fc6048da88"],
  ["account_security", "medium", "email-be303886db31"],
  ["government", "hard", "email-e44c29a7dbec"],
  ["workplace", "hard", "email-8ec97af8877d"],
];
const CALLS: [ScamCategory, Difficulty, string][] = [
  ["shipping", "easy", "call-0e5cfce002d9"],
  ["promotional", "easy", "call-d6ff8dcc42ad"],
  ["banking", "medium", "call-b5c8c2ff529a"],
  ["government", "medium", "call-9489cf86c8ae"],
  ["account_security", "hard", "call-279c76aa6092"],
];
/** Practice texts have no source row: Gemini writes each from library examples of its scam type. */
export const TEXTS: [ScamCategory, Difficulty][] = [
  ["shipping", "easy"],
  ["promotional", "easy"],
  ["banking", "medium"],
  ["account_security", "medium"],
  ["government", "hard"],
];

const EMAIL_CREDIT =
  "Adapted from a real phishing email in a public dataset (CC BY-SA 4.0), with every name and link swapped for invented ones.";
const CALL_CREDIT =
  "Follows a real scam-call pattern summarised from a public dataset (CC BY-NC-ND 4.0).";
const TEXT_CREDIT = "A practice text Gemini wrote from real scam examples.";

/** A stable clock time for a practice message, so rebuilding changes nothing. */
function receivedAt(id: string) {
  const n = createHash("sha1").update(id).digest().readUInt32BE(0);
  return `${1 + (n % 12)}:${String((n >> 4) % 60).padStart(2, "0")} ${(n >> 10) % 2 ? "AM" : "PM"}`;
}

function row(library: ScamLibrary, id: string, category: ScamCategory) {
  const example = library.examples.find((e) => e.id === id);
  if (!example || example.kind !== "scam" || example.category !== category) {
    throw new Error(
      `practice: library row ${id} is missing or no longer a ${category} scam; pick another`,
    );
  }
  return example;
}

export function practiceEmails(library: ScamLibrary) {
  return EMAILS.map(([category, difficulty, rowId]) => {
    const id = `lib-${rowId}`;
    const template = emailFromExample(
      row(library, rowId, category),
      category,
      difficulty,
    );
    const draft =
      template &&
      toScenario(JSON.stringify(template), {
        id: "gen-email-00000000-0000-4000-8000-000000000000",
        difficulty,
        category,
        receivedAt: receivedAt(id),
        generated: { source: "fallback", reason: EMAIL_CREDIT },
      });
    if (!draft || !("scenario" in draft)) {
      throw new Error(
        `practice: ${rowId} no longer builds a clean email${draft ? `: ${draft.problems[0]}` : ""}`,
      );
    }
    return { ...draft.scenario, id };
  });
}

export function practiceCalls(library: ScamLibrary) {
  return CALLS.map(([category, difficulty, rowId]) => {
    const example = row(library, rowId, category);
    const steps = patternSteps(example);
    if (!steps) {
      throw new Error(`practice: ${rowId} no longer makes a call pattern`);
    }
    const stored = patternCall(
      `lib-${rowId}`,
      category,
      { difficulty },
      steps,
      example.tactics,
      CALL_CREDIT,
    );
    const { teaching: _teaching, ...voice } = stored;
    return {
      fixture: { userId: "dev-user", scenario: CallScenario.parse(voice) },
      teaching: trainingCallScenario(stored),
    };
  });
}

// --- Practice texts: written by Gemini from library examples at build time, checked like the emails. ---

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const httpsUrl = z
  .string()
  .trim()
  .max(200)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an https URL");
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

const ModelText = z.object({
  title: text(3, 70),
  summary: text(10, 140),
  situation: text(10, 260),
  sender: text(3, 30).regex(
    /555\)?[- ]?01\d\d|^\d{5,6}$/,
    "must be a fictional 555-01xx number or a 5-6 digit short code",
  ),
  messages: z
    .array(z.object({ text: text(5, 320), link: optional(httpsUrl) }))
    .min(1)
    .max(3),
  tactics: z
    .array(Tactic)
    .min(1)
    .max(4)
    .transform((tactics) => [...new Set(tactics)]),
  redFlags: z
    .array(
      z.object({
        quote: text(2, 200),
        title: text(3, 80),
        reason: text(10, 500),
      }),
    )
    .min(3)
    .max(6),
  explanation: text(20, 600),
  nextTime: text(10, 400),
});

const Indicator = z.object({
  quote: text(2, 200),
  title: text(3, 80),
  detail: text(10, 500),
});

/** The frontend `SmsScenario` for a practice text (frontend/src/features/training/scenarios.ts). */
export const PracticeText = z
  .object({
    id: z.string().regex(/^lib-sms-[a-z_]+$/),
    type: z.literal("sms"),
    title: text(3, 70),
    summary: text(10, 140),
    situation: text(10, 260),
    difficulty: Difficulty,
    correctAction: z.literal("report"),
    sender: text(3, 30),
    receivedAt: text(1, 20),
    messages: z
      .array(
        z.object({ text: text(5, 320), link: httpsUrl.optional() }).strict(),
      )
      .min(1)
      .max(3),
    indicators: z.array(Indicator).min(3).max(6),
    explanation: text(20, 700),
    nextTime: text(10, 400),
    scamCategory: ScamCategory,
    tactics: z.array(Tactic).min(1).max(4),
    generated: z.object({
      source: z.literal("gemini"),
      reason: z.literal(TEXT_CREDIT),
      grounding: z.object({
        exampleCount: z.number().int().min(1),
        source: z.literal("scam-library"),
      }),
    }),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    const hidden = hiddenIndicators(
      rendered(scenario.messages, scenario.indicators),
    );
    if (hidden.length) {
      ctx.addIssue({
        code: "custom",
        path: ["indicators"],
        message: `not highlightable: ${hidden.join(" | ")}`,
      });
    }
    if (
      new Set(scenario.indicators.map((i) => i.title)).size !==
      scenario.indicators.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["indicators"],
        message: "duplicate titles",
      });
    }
    if (
      [
        scenario.sender,
        ...scenario.messages.flatMap((m) => [m.text, m.link ?? ""]),
      ].some((value) => blockedBrand.test(value))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["messages"],
        message: "names a real brand",
      });
    }
  });
export type PracticeText = z.infer<typeof PracticeText>;

/** The text bubbles as the email checks see them: SmsThread marks each message's text, and a link only as a whole URL. */
const rendered = (
  messages: { text: string; link?: string }[],
  indicators: z.infer<typeof Indicator>[],
) => ({
  fromAddress: "",
  subject: "",
  body: messages.map((m) => m.text),
  links: messages.flatMap((m) => (m.link ? [m.link] : [])),
  indicators,
});

export const textJsonSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        'Short scenario title for the training app, e.g. "Parcel held for a customs fee". Max 70 characters.',
    },
    summary: {
      type: "string",
      description:
        "One line on what the text claims, without saying it is a scam. Max 140 characters.",
    },
    situation: {
      type: "string",
      description:
        "What the trainee knows going in, one or two sentences, without giving the answer away.",
    },
    sender: {
      type: "string",
      description:
        'A fictional phone number in the 555-01xx range, e.g. "+1 (604) 555-0147", or a 5-6 digit short code.',
    },
    messages: {
      type: "array",
      description: "1 to 3 short text bubbles, as a real scam text would read.",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          link: {
            type: "string",
            description:
              "Optional https URL on an invented look-alike domain, shown after the text. Never inside the text.",
          },
        },
        required: ["text"],
      },
    },
    tactics: {
      type: "array",
      items: { type: "string", enum: Tactic.options },
      description: "1 to 4 social-engineering tactics this text uses.",
    },
    redFlags: {
      type: "array",
      description: "3 to 5 red flags, in the order they appear.",
      items: {
        type: "object",
        properties: {
          quote: {
            type: "string",
            description:
              "Copied EXACTLY, character for character, from a message text (a few words), or a whole link URL.",
          },
          title: {
            type: "string",
            description:
              "A plain-words name for the red flag, max 60 characters.",
          },
          reason: {
            type: "string",
            description:
              "One or two plain sentences on why it gives the scam away and what to check instead.",
          },
        },
        required: ["quote", "title", "reason"],
      },
    },
    explanation: {
      type: "string",
      description:
        "Two or three sentences for the debrief: what kind of scam this is and how it works.",
    },
    nextTime: {
      type: "string",
      description:
        "One or two sentences: the habit that would catch this next time.",
    },
  },
  required: [
    "title",
    "summary",
    "situation",
    "sender",
    "messages",
    "tactics",
    "redFlags",
    "explanation",
    "nextTime",
  ],
};

const textLevel: Record<Difficulty, string> = {
  easy: "EASY: several obvious tells, e.g. an unknown number, a threat with a short deadline, an odd link, a fee or prize out of nowhere.",
  medium:
    "MEDIUM: believable, with a plausible pretext and two or three clear tells such as a look-alike link and a request for a code or details.",
  hard: "HARD: calm, polite and personal, no shouting or spelling mistakes; only subtle tells such as a look-alike link or an unusual request.",
};

/** Up to three library examples for a text: real texts of the category first, then emails and call patterns, which carry the same tricks. */
function textExamples(
  library: ScamLibrary,
  category: ScamCategory,
  difficulty: Difficulty,
) {
  const pick = (channel: LibraryExample["channel"]) =>
    library.examplesFor({ channel, category, difficulty, limit: 3 });
  return [...pick("sms"), ...pick("email"), ...pick("call")].slice(0, 3);
}

export function textPrompt(
  category: ScamCategory,
  difficulty: Difficulty,
  examples: readonly LibraryExample[],
) {
  return `You write one practice scam TEXT MESSAGE (SMS) for Tellio, a scam-awareness trainer. It appears on a pretend phone in a training app and is explained in a debrief afterwards.

SCAM TYPE: it pretends to come from ${categoryBrief[category]}.
LEVEL: ${textLevel[difficulty]}

RULES:
- Invent every organisation, person and web address. Never name a real company, bank, courier, app or government body.
- The sender is a fictional number in the 555-01xx range or a 5-6 digit short code.
- Write it like a real text: short, plain, the way a scammer would really send it. Put any link in "link", not in the text.
- Each red flag quotes a few words copied exactly from a message text, or a whole link URL.
${groundingBlock(examples)}`;
}

/** One practice text for a slot, or null when Gemini fails twice (the build then keeps the committed one). */
export async function generatePracticeText(
  model: JsonModel,
  library: ScamLibrary,
  category: ScamCategory,
  difficulty: Difficulty,
): Promise<PracticeText | null> {
  const examples = textExamples(library, category, difficulty);
  if (!examples.length) return null; // never write an ungrounded practice text
  const id = `lib-sms-${category}`;
  return generateChecked(
    model,
    textPrompt(category, difficulty, examples),
    textJsonSchema,
    30_000,
    (raw) =>
      checkText(raw, {
        id,
        category,
        difficulty,
        exampleCount: examples.length,
      }),
    `practice ${category} text`,
  );
}

/** Model JSON to a checked practice text, repairing near-miss quotes; otherwise the problems, for a retry. */
export function checkText(
  raw: string,
  meta: {
    id: string;
    category: ScamCategory;
    difficulty: Difficulty;
    exampleCount: number;
  },
): { value: PracticeText } | { problems: string[] } {
  const json = parseModelJson(raw);
  if (json === undefined) {
    return { problems: ["The answer was not valid JSON."] };
  }
  const parsed = ModelText.safeParse(json);
  if (!parsed.success) {
    return {
      problems: parsed.error.issues
        .slice(0, 8)
        .map(
          (issue) => `${issue.path.join(".") || "answer"}: ${issue.message}`,
        ),
    };
  }
  const sms = parsed.data;
  const messages = sms.messages.map((m) =>
    m.link ? { text: m.text, link: m.link } : { text: m.text },
  );
  const shown = rendered(messages, []);
  const visible: z.infer<typeof Indicator>[] = [];
  for (const flag of sms.redFlags) {
    const quote = hiddenIndicators({
      ...shown,
      indicators: [{ ...flag, detail: "" }],
    }).length
      ? (repairQuote(flag.quote, shown) ?? flag.quote)
      : flag.quote;
    const candidate = [
      ...visible,
      { quote, title: flag.title, detail: flag.reason },
    ];
    if (
      !visible.some((kept) => kept.title === flag.title) &&
      !hiddenIndicators({ ...shown, indicators: candidate }).length
    ) {
      visible.push(candidate[candidate.length - 1]);
    }
  }
  const problems: string[] = [];
  if (visible.length < 3) {
    problems.push(
      "At least 3 redFlags quotes must be copied exactly from a message text or be a whole link URL, and must not overlap.",
    );
  }
  const scenario = PracticeText.safeParse({
    id: meta.id,
    type: "sms",
    title: sms.title,
    summary: sms.summary,
    situation: sms.situation,
    difficulty: meta.difficulty,
    correctAction: "report",
    sender: sms.sender,
    receivedAt: receivedAt(meta.id),
    messages,
    indicators: visible.slice(0, 6),
    explanation: sms.explanation,
    nextTime: sms.nextTime,
    scamCategory: meta.category,
    tactics: sms.tactics,
    generated: {
      source: "gemini",
      reason: TEXT_CREDIT,
      grounding: { exampleCount: meta.exampleCount, source: "scam-library" },
    },
  });
  if (!scenario.success) {
    problems.push(
      ...scenario.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return problems.length || !scenario.success
    ? { problems }
    : { value: scenario.data };
}

/**
 * The live comms text thread's scenario for a practice text (`/api/comms/texts`): its opening message, with the link
 * as the tracked `{{link}}`, and a generic persona for the reply provider.
 */
export function textThreadScenario(sms: PracticeText) {
  const link = sms.messages.find((m) => m.link)?.link;
  return TextScenario.parse({
    id: sms.id,
    title: sms.title,
    tactics: sms.tactics,
    difficulty: ({ easy: 1, medium: 2, hard: 3 } as const)[sms.difficulty],
    senderLabel: sms.sender,
    openingMessage: `${sms.messages.map((m) => m.text).join(" ")}${link ? " {{link}}" : ""}`,
    ...(link ? { linkDisplayUrl: link.replace(/^https:\/\//, "") } : {}),
    persona: `You sent this scam text: "${sms.messages.map((m) => m.text).join(" ")}". Keep replies short, like texts. Stay in character, push the same way (${sms.tactics.join(", ")}), and never name a real company.`,
    maxTurns: 4,
  });
}

/** Everything the practice path ships: the frontend file's contents and the comms fixtures. */
export function buildPractice(library: ScamLibrary, texts: PracticeText[]) {
  const calls = practiceCalls(library);
  return {
    practice: {
      emails: practiceEmails(library),
      texts,
      calls: calls.map((c) => c.teaching),
    },
    fixtures: {
      ...Object.fromEntries(
        calls.map((c) => [`call-${c.fixture.scenario.id}.json`, c.fixture]),
      ),
      ...Object.fromEntries(
        texts.map((t) => [
          `text-${t.id}.json`,
          { userId: "dev-user", scenario: textThreadScenario(t) },
        ]),
      ),
    },
  };
}
