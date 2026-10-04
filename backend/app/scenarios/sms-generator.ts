import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { Difficulty, ScamCategory, Tactic } from "../shared/vocabulary.ts";
import {
  categoryBrief,
  focusReason,
  hiddenIndicators,
  reason,
  repairQuote,
} from "./email-generator.ts";
import { generateChecked, parseModelJson, type JsonModel } from "./gemini.ts";
import { cleanProfileText } from "./generator.ts";
import { groundingBlock, type ScamLibrary } from "./library.ts";
import { PRACTICE_FILE } from "./practice.ts";

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

const Indicator = z.object({
  quote: text(2, 200),
  title: text(3, 80),
  detail: text(10, 500),
});

/**
 * The frontend `SmsScenario` (frontend/src/features/training/scenarios.ts) as
 * received by the browser.
 */
export const SmsScenario = z
  .object({
    id: z.string().regex(/^gen-sms-[0-9a-f-]{36}$/),
    type: z.literal("sms"),
    title: text(3, 70),
    summary: text(10, 140),
    situation: text(10, 260),
    difficulty: Difficulty,
    correctAction: z.enum(["report", "safe"]),
    sender: text(3, 30),
    receivedAt: text(1, 20),
    messages: z
      .array(
        z.object({
          text: text(5, 320),
          link: optional(httpsUrl),
        }),
      )
      .min(1)
      .max(3),
    indicators: z.array(Indicator).min(3).max(6),
    explanation: text(20, 700),
    nextTime: text(10, 400),
    scamCategory: ScamCategory.optional(),
    tactics: z.array(Tactic).min(1).max(4).optional(),
    generated: z.object({
      source: z.enum(["gemini", "fallback"]),
      reason: z.string().min(1),
      grounding: z
        .object({
          exampleCount: z.number().int().min(1),
          source: z.literal("scam-library"),
        })
        .optional(),
    }),
  })
  .strict();
export type SmsScenario = z.infer<typeof SmsScenario>;

const ModelText = z.object({
  title: text(3, 70),
  summary: text(10, 140),
  situation: text(10, 260),
  sender: text(3, 30),
  messages: z
    .array(
      z.object({
        text: text(5, 320),
        link: optional(httpsUrl),
      }),
    )
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
  explanation: text(20, 700),
  nextTime: text(10, 400),
});

export const smsJsonSchema = {
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
        "A fictional phone number in 555-01xx range or a 5-6 digit short code.",
    },
    messages: {
      type: "array",
      description: "1 to 3 text messages in chronological order.",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The body text of the SMS, max 320 characters.",
          },
          link: {
            type: "string",
            description:
              "Optional https URL on an invented look-alike domain. Never inside the text.",
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

export interface SmsGenerationInput {
  profession?: string | null;
  interests?: string[];
  difficulty: Difficulty;
  weakCategories?: ScamCategory[];
  vulnerableTactics?: string[];
  /**
   * Preferred categories, e.g. Snowflake's `nextTrainingFocus`; the first valid
   * one wins over weak categories.
   */
  focus?: ScamCategory[];
  /** Unset uses the built-in SMS. */
  model?: JsonModel;
  /**
   * Real-world examples to ground the prompt; none (or no library) runs the
   * prompt ungrounded.
   */
  library?: ScamLibrary;
  budgetMs?: number;
}

const categoryNoun: Record<ScamCategory, string> = {
  banking: "bank text scams",
  government: "tax and agency text scams",
  shipping: "parcel delivery smishing",
  account_security: "two-factor authentication and account alert scams",
  workplace: "workplace urgent text scams",
  promotional: "prize and promotion text scams",
};

const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

function plan(input: SmsGenerationInput) {
  const profession = cleanProfileText(input.profession ?? "", 60);
  const interests = (input.interests ?? [])
    .slice(0, 5)
    .map((i) => cleanProfileText(i ?? "", 40))
    .filter(Boolean);
  const focus = (input.focus ?? []).find(
    (category) => ScamCategory.safeParse(category).success,
  );
  const weak = input.weakCategories?.[0];
  const category: ScamCategory =
    focus ??
    weak ??
    pick([
      "shipping",
      "banking",
      "account_security",
      "promotional",
      "government",
    ]);
  const tactics = (input.vulnerableTactics ?? [])
    .filter((tactic) => /^[a-z_]{2,20}$/.test(tactic))
    .slice(0, 3);
  const why = focusReason(categoryNoun[category], focus, weak);

  return { profession, interests, category, tactics, why };
}

function promptFor(input: SmsGenerationInput, p: ReturnType<typeof plan>) {
  return `You write practice SMS / text messages for chatisthisreal, a scam-awareness training app. Write ONE realistic smishing text message for a trainee to judge.

CATEGORY: ${p.category}, from ${categoryBrief[p.category]}.
DIFFICULTY: ${input.difficulty}
TACTICS THIS TRAINEE HAS FALLEN FOR: ${p.tactics.join(", ") || "none recorded yet"}

TRAINEE CONTEXT:
- Profession: ${p.profession || "not given"}
- Interests: ${p.interests.join(", ") || "not given"}

RULES:
- Invented organisations, people and domains only. Never name or imitate a real brand, company, courier, or bank.
- The sender must be a fictional 555-01xx number or a 5-6 digit short code.
- Write it like a real text: short, punchy, the way an SMS scammer would really send it. Put any link in "link", not inside the text.
- redFlags: 3 to 5, each quote copied EXACTLY from a message text or link URL. Quotes must not overlap.
- Titles, reasons, explanation and nextTime are for the trainee: short, kind, plain words.`;
}

const rendered = (messages: { text: string; link?: string }[]) => ({
  fromAddress: "",
  subject: "",
  body: messages.map((m) => m.text),
  links: messages.flatMap((m) => (m.link ? [m.link] : [])),
  indicators: [] as z.infer<typeof Indicator>[],
});

function checkSms(
  raw: string,
  meta: {
    id: string;
    category: ScamCategory;
    difficulty: Difficulty;
    generated: SmsScenario["generated"];
  },
): { value: SmsScenario } | { problems: string[] } {
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
  const shown = rendered(messages);
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

  const now = new Date();
  const timeStr = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")} ${now.getHours() >= 12 ? "PM" : "AM"}`;

  const scenario = SmsScenario.safeParse({
    id: meta.id,
    type: "sms",
    title: sms.title,
    summary: sms.summary,
    situation: sms.situation,
    difficulty: meta.difficulty,
    correctAction: "report",
    sender: sms.sender,
    receivedAt: timeStr,
    messages,
    indicators: visible.slice(0, 6),
    explanation: sms.explanation,
    nextTime: sms.nextTime,
    scamCategory: meta.category,
    tactics: sms.tactics,
    generated: meta.generated,
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

/** Fallback committed practice texts loaded from practice.json. */
let cachedCommittedTexts: SmsScenario[] | null = null;
function getCommittedTexts(): SmsScenario[] {
  if (cachedCommittedTexts) return cachedCommittedTexts;
  try {
    const raw = readFileSync(PRACTICE_FILE, "utf8");
    cachedCommittedTexts = (JSON.parse(raw).texts ?? []) as SmsScenario[];
  } catch {
    cachedCommittedTexts = [];
  }
  return cachedCommittedTexts;
}

/**
 * Generates a personalised scam SMS: Gemini when configured, checked and
 * repaired, else a built-in one.
 */
export async function generateSmsScenario(
  input: SmsGenerationInput,
): Promise<{ scenario: SmsScenario; source: "gemini" | "fallback" }> {
  const p = plan(input);
  const id = `gen-sms-${randomUUID()}`;

  if (input.model) {
    const examples =
      input.library?.examplesFor({
        channel: "sms",
        category: p.category,
        tactics: p.tactics,
        difficulty: input.difficulty,
      }) ?? [];
    const generated: SmsScenario["generated"] = {
      source: "gemini",
      reason: reason(p.why, p.profession, p.interests[0]),
      ...(examples.length
        ? {
            grounding: {
              exampleCount: examples.length,
              source: "scam-library" as const,
            },
          }
        : {}),
    };

    const scenario = await generateChecked(
      input.model,
      promptFor(input, p) + groundingBlock(examples),
      smsJsonSchema,
      input.budgetMs ?? 20_000,
      (raw) => {
        const checked = checkSms(raw, {
          id,
          category: p.category,
          difficulty: input.difficulty,
          generated,
        });
        return "value" in checked ? { value: checked.value } : checked;
      },
      "SMS",
    );
    if (scenario) return { scenario, source: "gemini" };
  }

  const committed = getCommittedTexts();
  const match =
    committed.find((t) => t.scamCategory === p.category) ??
    committed.find((t) => t.difficulty === input.difficulty) ??
    committed[0];

  const whyText = reason(p.why, p.profession, p.interests[0]);
  if (match) {
    const fallbackScenario: SmsScenario = {
      ...match,
      id,
      generated: {
        source: "fallback",
        reason: `${whyText} Adapted from practice library examples.`,
      },
    };
    return { scenario: fallbackScenario, source: "fallback" };
  }

  // Last-resort fallback text if practice.json could not be read
  const lastResort: SmsScenario = {
    id,
    type: "sms",
    title: "Suspicious parcel delivery reschedule",
    summary:
      "A text claims your delivery is paused until you confirm your details.",
    situation:
      "You receive a text notification on your phone about an unexpected package.",
    difficulty: input.difficulty,
    correctAction: "report",
    sender: "555-0192",
    receivedAt: "10:14 AM",
    messages: [
      {
        text: "Courier Express: Your package #849201 is on hold due to missing address info. Confirm online immediately.",
        link: "https://courier-express-hold.example/update",
      },
    ],
    indicators: [
      {
        quote: "on hold due to missing address info",
        title: "Vague package problem",
        detail:
          "Legitimate couriers do not send abrupt text warnings without prior tracking info.",
      },
      {
        quote: "immediately",
        title: "Urgent pressure",
        detail: "Scammers use immediate deadlines to rush you into clicking.",
      },
      {
        quote: "https://courier-express-hold.example/update",
        title: "Look-alike web link",
        detail:
          "The link points to an unverified address instead of an official delivery website.",
      },
    ],
    explanation:
      "This is a package delivery smishing scam designed to steal your personal and payment details.",
    nextTime:
      "Never tap links in delivery texts. Look up the courier's official portal yourself.",
    scamCategory: p.category,
    tactics: ["urgency", "suspicious_link"],
    generated: {
      source: "fallback",
      reason: whyText,
    },
  };
  return { scenario: lastResort, source: "fallback" };
}
