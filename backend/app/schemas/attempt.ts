import { z } from 'zod';
import { channelSchema, difficultySchema, kindSchema, tacticSchema, timestampSchema, uuidSchema } from './domain.js';

export const findingSchema = z.object({
  tactic: tacticSchema,
  outcome: z.enum(['caught', 'missed', 'unknown']),
  evidence: z.string().trim().min(1).max(4000),
}).strict();
export const assessmentSchema = z.object({
  attemptId: uuidSchema,
  rubricVersion: z.string().trim().min(1).max(100),
  score: z.number().finite().min(0).max(100),
  classification: z.enum(['correct', 'incorrect', 'unknown']),
  findings: z.array(findingSchema).max(5).refine((xs) => new Set(xs.map((x) => x.tactic)).size === xs.length, 'Duplicate tactic'),
  feedback: z.string().trim().min(1).max(10000),
}).strict();
export const historyEntrySchema = assessmentSchema.extend({
  assessedAt: timestampSchema,
  kind: kindSchema,
  difficulty: difficultySchema,
  patternId: uuidSchema,
  channel: channelSchema,
}).refine((h) => h.kind !== 'legitimate' || h.findings.length === 0, 'Legitimate communications cannot carry scam tactic findings');
export const scenarioSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sender: z.string().trim().min(1).max(200),
  openingText: z.string().trim().min(1).max(10000),
}).strict();
export type Assessment = z.infer<typeof assessmentSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
