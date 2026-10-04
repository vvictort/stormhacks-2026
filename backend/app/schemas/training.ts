import { z } from 'zod';
import { Tactic } from '../../comms/src/types.ts';

const text = (max: number) => z.string().trim().min(1).max(max);

// Unknown keys are stripped, so only the redacted summary and transcript ever reach metadata.
export const attemptSchema = z.object({
  attemptId: text(128),
  firebaseUid: text(128),
  channel: z.enum(['sms', 'email', 'call']),
  scenarioId: text(128),
  scenarioTitle: text(200),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  tactics: z.array(Tactic).max(10),
  outcome: z.enum(['resisted', 'compromised', 'declined', 'missed', 'error']),
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
