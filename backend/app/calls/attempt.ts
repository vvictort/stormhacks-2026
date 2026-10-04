import {
  attemptSchema,
  type AttemptInput,
} from "../training/attempts.schema.ts";
import type { CallRecord } from "../shared/types.ts";

// attemptSchema's limits. A longer value would reject the whole attempt, so clip instead:
// a shortened summary is better than a lost result.
const MAX_TRANSCRIPT_TURNS = 200;
const MAX_TEXT = 4000;
const MAX_TITLE = 200;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The training attempt saved for a completed call: canonical result, redacted text only. */
export function trainingAttempt(call: CallRecord): AttemptInput {
  const training = call.training!;
  return attemptSchema.parse({
    attemptId: call.id,
    firebaseUid: call.userId,
    channel: "call",
    scenarioId: call.scenario.id,
    scenarioTitle: clip(call.scenario.title, MAX_TITLE),
    difficulty: training.difficulty,
    scamCategory: call.scenario.scamCategory ?? null,
    tactics: call.scenario.tactics,
    outcome: training.outcome,
    success: training.success,
    signals: call.signals,
    startedAt: call.createdAt,
    completedAt: call.completedAt!,
    durationSecs: call.durationSecs ?? null,
    summary: call.summary ? clip(call.summary, MAX_TEXT) : null,
    // Already redacted when the analysis was stored; raw captions never reach the server.
    transcript: (call.transcript ?? [])
      .slice(0, MAX_TRANSCRIPT_TURNS)
      .map((t) => ({ ...t, message: clip(t.message, MAX_TEXT) })),
  });
}
