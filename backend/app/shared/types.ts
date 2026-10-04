import { z } from "zod";
import {
  ScamCategory,
  Tactic,
  type Difficulty,
  type Outcome,
} from "./vocabulary.ts";

// Simulation (text and call) shapes. Canonical words live in vocabulary.ts.

/** Observed user behaviours. Rule-based hints from the texts service, authoritative ones from the provider / ElevenLabs analysis. */
export type Signal =
  | "clicked_link"
  | "shared_code"
  | "shared_personal_info"
  | "shared_payment_info"
  | "agreed_to_action"
  | "engaged"
  | "challenged"
  | "asked_to_verify"
  | "reported"
  | "stop";

/** Signals that mean the user fell for the scam. */
export const COMPROMISING_SIGNALS: readonly Signal[] = [
  "clicked_link",
  "shared_code",
  "shared_personal_info",
  "shared_payment_info",
  "agreed_to_action",
];

/** A simulation's raw outcome; calls map it to the canonical `Outcome` (calls/outcome.ts). */
export type SimOutcome =
  | "compromised"
  | "resisted"
  | "reported"
  | "ignored"
  | "declined"
  | "missed"
  | "error";

export type SimChannel = "text" | "call";

const scenarioBase = {
  id: z.string().min(1),
  title: z.string().min(1),
  tactics: z.array(Tactic).min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
};

export const TextScenario = z
  .object({
    ...scenarioBase,
    /** Shown as the sender in the fake messaging UI (a name or a fake number). */
    senderLabel: z.string().min(1),
    /** First scam text. `{{link}}` is replaced with `linkDisplayUrl` and made tappable. */
    openingMessage: z.string().min(1),
    /** Fake domain shown to the user, e.g. "postnorth-redelivery.info/pay". */
    linkDisplayUrl: z.string().min(1).optional(),
    /** How the scammer should behave in follow-up replies (for the reply provider). */
    persona: z.string().min(1),
    /** Max scammer replies after the opening message before the thread ends. */
    maxTurns: z.number().int().min(1).max(20),
  })
  .refine((s) => !s.openingMessage.includes("{{link}}") || s.linkDisplayUrl, {
    message: "linkDisplayUrl is required when openingMessage contains {{link}}",
    path: ["linkDisplayUrl"],
  });
export type TextScenario = z.infer<typeof TextScenario>;

export const CallScenario = z.object({
  ...scenarioBase,
  /** Shown on the ringing screen (a name or a fake number). */
  callerLabel: z.string().min(1),
  /** Scam persona/instructions for the ElevenLabs agent; the safety preamble is prepended server-side. */
  systemPrompt: z.string().min(1),
  firstMessage: z.string().min(1),
  voiceId: z.string().min(1).optional(),
  /** Known for generated calls; fixtures leave it out and the backend infers it (training/progress.ts). */
  scamCategory: ScamCategory.optional(),
});
export type CallScenario = z.infer<typeof CallScenario>;

export const difficultyName: Record<CallScenario["difficulty"], Difficulty> = {
  1: "easy",
  2: "medium",
  3: "hard",
};

export interface TextLink {
  text: string;
  href: string;
}

export interface TextMessage {
  id: string;
  from: "scammer" | "user";
  /** User messages are redacted before they are stored. */
  body: string;
  at: string;
  links?: TextLink[];
  /** User messages: ms since the previous scammer message. */
  latencyMs?: number;
  /** User messages: rule-based signals detected in this message. */
  signals?: Signal[];
  /** Scammer messages: true for an unprompted nudge after silence. */
  followUp?: boolean;
}

export type ThreadEndReason =
  "provider_done" | "max_turns" | "reported" | "link_clicked" | "idle";

export interface TextThread {
  id: string;
  userId: string;
  scenario: TextScenario;
  status: "active" | "ended";
  outcome?: SimOutcome;
  endReason?: ThreadEndReason;
  messages: TextMessage[];
  signals: Signal[];
  /** Scammer replies sent after the opening message (follow-up nudges excluded). */
  scammerTurns: number;
  /** How many user messages have been passed to the reply provider. */
  userMessagesHandled: number;
  linkToken?: string;
  linkFirstSentAt?: string;
  firstClickAt?: string;
  followUpSentAt?: string;
  createdAt: string;
  endedAt?: string;
}

export type CallStatus = "ringing" | "in_call" | "analyzing" | "completed";

export interface CallTranscriptTurn {
  role: "agent" | "user";
  /** Redacted. */
  message: string;
  timeInCallSecs: number;
}

/** Canonical training result (see docs/call-integration.md); the browser and progress code never reinterpret it. */
export interface CallTraining {
  outcome: Outcome;
  /** Null when the attempt isn't scored (errors). */
  success: boolean | null;
  difficulty: Difficulty;
}

export interface CallRecord {
  id: string;
  userId: string;
  scenario: CallScenario;
  status: CallStatus;
  outcome?: SimOutcome;
  /** Set together with `outcome` once the call is completed. */
  training?: CallTraining;
  /** ElevenLabs conversation bound to this call; analysis only ever uses this id. */
  conversationId?: string;
  createdAt: string;
  acceptedAt?: string;
  endedAt?: string;
  completedAt?: string;
  durationSecs?: number;
  /** Redacted. */
  summary?: string;
  transcript?: CallTranscriptTurn[];
  /** ElevenLabs data-collection results, rationale redacted. */
  dataCollection?: Record<string, { value: unknown; rationale?: string }>;
  /** ElevenLabs `user_resisted` evaluation result. */
  resisted?: string;
  signals: Signal[];
  error?: string;
}

export type SimEventType =
  | "text.thread_started"
  | "text.message_sent"
  | "text.reply_received"
  | "text.reply_classified"
  | "text.follow_up_sent"
  | "text.reported"
  | "text.thread_ended"
  | "link.clicked"
  | "call.ringing"
  | "call.accepted"
  | "call.declined"
  | "call.missed"
  | "call.abandoned"
  | "call.ended"
  | "call.analyzed"
  | "call.failed";

export interface SimEvent {
  id: string;
  type: SimEventType;
  at: string;
  userId: string;
  /** Thread id or call id. */
  simulationId: string;
  channel: SimChannel;
  scenarioId: string;
  tactics: Tactic[];
  data: Record<string, unknown>;
}
