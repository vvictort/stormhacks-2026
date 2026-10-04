import { z } from 'zod';
import { Channel, Difficulty, Outcome, ScamCategory, Tactic } from '../shared/vocabulary.ts';

const text = (max: number) => z.string().trim().min(1).max(max);

// Unknown keys are stripped, so only the redacted summary and transcript ever reach metadata.
export const attemptSchema = z.object({
  attemptId: text(128),
  firebaseUid: text(128),
  channel: Channel,
  scenarioId: text(128),
  scenarioTitle: text(200),
  difficulty: Difficulty,
  scamCategory: ScamCategory.nullable().default(null),
  tactics: z.array(Tactic).max(10),
  outcome: Outcome,
  success: z.boolean().nullable(),
  signals: z.array(text(40)).max(20),
  startedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  completedAt: z.iso.datetime({ offset: true }),
  durationSecs: z.number().nonnegative().max(86400).nullable().default(null).transform((v) => v === null ? null : Math.round(v)),
  summary: z.string().max(4000).nullable().default(null),
  transcript: z.array(z.object({
    role: z.enum(['agent', 'user']),
    message: z.string().max(4000),
    timeInCallSecs: z.number().nonnegative(),
  })).max(200).default([]),
});
export type AttemptInput = z.infer<typeof attemptSchema>;

export interface AttemptSummary {
  id: string;
  channel: AttemptInput['channel'];
  scenarioId: string;
  scenarioTitle: string;
  difficulty: AttemptInput['difficulty'];
  scamCategory: AttemptInput['scamCategory'];
  outcome: AttemptInput['outcome'];
  success: boolean | null;
  tactics: string[];
  completedAt: string;
}

export interface AttemptDetail extends AttemptSummary {
  signals: string[];
  startedAt: string | null;
  durationSecs: number | null;
  summary: string | null;
  transcript: AttemptInput['transcript'];
}
