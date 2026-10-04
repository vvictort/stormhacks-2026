import { z } from "zod";

// The canonical words shared with the frontend and the database; see docs/call-integration.md and docs/mvp-contracts.md.
export const Channel = z.enum(["sms", "email", "call"]);
export const Difficulty = z.enum(["easy", "medium", "hard"]);
// Calls: resisted, compromised, declined, missed, error. Texts and emails: what the user chose, and whether it was right.
export const Outcome = z.enum([
  "resisted",
  "compromised",
  "declined",
  "missed",
  "error",
  "reported_correct",
  "reported_incorrect",
  "safe_correct",
  "safe_incorrect",
]);
export const Tactic = z.enum([
  "urgency",
  "authority",
  "suspicious_link",
  "otp_request",
  "info_request",
  "reward",
  "fear",
]);
export const ScamCategory = z.enum([
  "banking",
  "government",
  "shipping",
  "account_security",
  "workplace",
  "promotional",
]);

/** Behavioural events stored in TigerData (`behavior_events`). */
export const BehaviorEventType = z.enum([
  "scenario_started",
  "message_opened",
  "sender_inspected",
  "link_clicked",
  "attachment_opened",
  "message_reported",
  "message_marked_safe",
  "call_received",
  "call_answered",
  "call_declined",
  "call_missed",
  "call_ended",
  "scenario_completed",
  "debrief_viewed",
]);

export type Channel = z.infer<typeof Channel>;
export type Difficulty = z.infer<typeof Difficulty>;
export type Outcome = z.infer<typeof Outcome>;
export type Tactic = z.infer<typeof Tactic>;
export type ScamCategory = z.infer<typeof ScamCategory>;
export type BehaviorEventType = z.infer<typeof BehaviorEventType>;

/** Whether an outcome counts as the right call; null when it isn't scored. */
export const outcomeSuccess = (outcome: Outcome): boolean | null =>
  outcome === "error"
    ? null
    : !["compromised", "reported_incorrect", "safe_incorrect"].includes(
        outcome,
      );

/** The user fell for the scam: shared details on a call, or trusted a scam message. */
export const fellForScam = (outcome: string) =>
  outcome === "compromised" || outcome === "safe_incorrect";
