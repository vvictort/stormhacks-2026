import { Router } from "express";
import { z } from "zod";
import type { Repositories } from "../repositories.ts";
import { redact } from "../shared/redact.ts";
import {
  BehaviorEventType,
  Difficulty,
  Outcome,
  outcomeSuccess,
  ScamCategory,
  Tactic,
} from "../shared/vocabulary.ts";
import { inferCategory } from "../training/progress.ts";
import type { BehaviorEvent } from "./behavior.repository.ts";

export const MAX_BATCH = 50;
/** Browser clocks drift and queues flush late: older timestamps are pulled up to this, future ones down to now. */
export const MAX_EVENT_AGE_MS = 10 * 60_000;
const MAX_METADATA_BYTES = 512;
// Metadata is for small facts about a tap (e.g. the practice link's site), never anything the user typed or said.
const SENSITIVE_KEY =
  /text|message|body|reply|transcript|email|phone|password|code|otp|card|name/i;

// Call events come from the server's own call lifecycle (call-events.ts), never from the browser.
const BrowserEventType = BehaviorEventType.exclude([
  "call_received",
  "call_answered",
  "call_declined",
  "call_missed",
  "call_ended",
]);
const MessageOutcome = Outcome.extract([
  "reported_correct",
  "reported_incorrect",
  "safe_correct",
  "safe_incorrect",
]);

const browserEvent = z
  .object({
    type: BrowserEventType,
    channel: z.enum(["sms", "email"]),
    scenarioId: z.string().trim().min(1).max(128),
    scenarioTitle: z.string().trim().min(1).max(200),
    // A browser-made UUID per run, so it can never collide with a call id in training_attempts.
    attemptId: z.uuid(),
    scamCategory: ScamCategory.optional(),
    difficulty: Difficulty,
    outcome: MessageOutcome.optional(),
    /** The scenario's tactics; a finished run stores them with its training attempt. */
    tactics: z
      .array(Tactic)
      .max(Tactic.options.length)
      .transform((tactics) => [...new Set(tactics)])
      .optional(),
    responseTimeMs: z.number().int().nonnegative().max(86_400_000).optional(),
    metadata: z
      .record(
        z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
        z.union([z.string().max(200), z.number(), z.boolean()]),
      )
      .refine(
        (m) =>
          Object.keys(m).length <= 8 &&
          JSON.stringify(m).length <= MAX_METADATA_BYTES,
        "metadata is too large",
      )
      .transform((m) =>
        Object.fromEntries(
          Object.entries(m)
            .filter(([key]) => !SENSITIVE_KEY.test(key))
            .map(([key, value]) => [
              key,
              typeof value === "string" ? redact(value) : value,
            ]),
        ),
      )
      .default({}),
    at: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    (e) => (e.type === "scenario_completed") === (e.outcome !== undefined),
    { message: "outcome goes with scenario_completed only", path: ["outcome"] },
  );

export const eventBatch = z.object({
  events: z.array(browserEvent).min(1).max(MAX_BATCH),
});

/** A browser timestamp within [now - MAX_EVENT_AGE_MS, now]; missing means now. */
export function clampTime(at: string | undefined, now = Date.now()) {
  const t = at ? Date.parse(at) : now;
  return new Date(
    Math.min(now, Math.max(now - MAX_EVENT_AGE_MS, t)),
  ).toISOString();
}

export function behaviorRouter(
  repos: Pick<Repositories, "behavior" | "attempts">,
) {
  const router = Router();

  router.post("/events", async (req, res) => {
    const uid = req.user!.uid;
    const now = Date.now();
    const parsed = eventBatch.parse(req.body).events.map((e) => ({
      ...e,
      at: clampTime(e.at, now),
      scamCategory:
        e.scamCategory ??
        inferCategory({ id: e.scenarioId, title: e.scenarioTitle }),
    }));
    await repos.behavior.record(
      parsed.map((e): BehaviorEvent => ({
        at: e.at,
        uid,
        type: e.type,
        channel: e.channel,
        scenarioId: e.scenarioId,
        attemptId: e.attemptId,
        scamCategory: e.scamCategory,
        difficulty: e.difficulty,
        outcome: e.outcome ?? null,
        responseTimeMs: e.responseTimeMs ?? null,
        metadata: e.metadata,
      })),
    );

    // A finished text or email is also a training attempt, so the vulnerability profile and adaptive difficulty see
    // every channel. Idempotent on the attempt id.
    for (const e of parsed) {
      if (e.type !== "scenario_completed" || !e.outcome) continue;
      const startedAt =
        e.responseTimeMs === undefined
          ? null
          : new Date(Date.parse(e.at) - e.responseTimeMs).toISOString();
      await repos.attempts.insert({
        attemptId: e.attemptId,
        firebaseUid: uid,
        channel: e.channel,
        scenarioId: e.scenarioId,
        scenarioTitle: e.scenarioTitle,
        difficulty: e.difficulty,
        scamCategory: e.scamCategory,
        tactics: e.tactics ?? [],
        outcome: e.outcome,
        success: outcomeSuccess(e.outcome),
        signals: [],
        startedAt,
        completedAt: e.at,
        durationSecs:
          e.responseTimeMs === undefined
            ? null
            : Math.round(e.responseTimeMs / 1000),
        summary: null,
        transcript: [],
      });
    }
    res.status(202).json({ accepted: parsed.length });
  });

  router.get("/metrics", async (req, res) => {
    res.json(await repos.behavior.metrics(req.user!.uid));
  });

  return router;
}
