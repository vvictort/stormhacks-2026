import { z } from 'zod';
import { channels, channelSchema, difficultySchema, kindSchema, tacticSchema, tactics, uuidSchema } from './domain.js';
import { historyEntrySchema } from './attempt.js';

export const patternSchema = z.object({
  id: uuidSchema,
  kind: kindSchema,
  channel: channelSchema,
  category: z.string().min(1),
  tactics: z.array(tacticSchema),
  contextTags: z.array(z.string()),
  example: z.string().min(1),
  warningSigns: z.array(z.string()),
  provenance: z.object({ synthetic: z.boolean(), sourceUrl: z.url().nullable() }).strict(),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.tactics).size !== p.tactics.length) ctx.addIssue({ code: 'custom', message: 'Duplicate tactic' });
  if ((p.kind === 'legitimate' && p.tactics.length) || (p.kind === 'scam' && !p.tactics.length)) {
    ctx.addIssue({ code: 'custom', message: 'Pattern tactics must match its kind' });
  }
  if (!p.provenance.synthetic && !p.provenance.sourceUrl) ctx.addIssue({ code: 'custom', message: 'Sourced patterns require a URL' });
});
const weaknessSchema = z.object({ weakness: z.number().min(0).max(1), evidenceCount: z.number().int().min(0).max(20), untested: z.boolean() }).strict();
const rateSchema = z.object({ rate: z.number().min(0).max(1).nullable(), errors: z.number().int().min(0), assessed: z.number().int().min(0) }).strict();
export const profileSchema = z.object({
  weaknesses: z.object(Object.fromEntries(tactics.map((t) => [t, weaknessSchema])) as Record<typeof tactics[number], typeof weaknessSchema>).strict(),
  falseAlarms: rateSchema,
  scamMisses: rateSchema,
  currentDifficulty: difficultySchema,
  assessedCount: z.number().int().min(0),
  engineVersion: z.literal('rules-v1'),
}).strict();
export const profileRequestSchema = z.object({ history: z.array(historyEntrySchema).refine((xs) => new Set(xs.map((x) => x.attemptId)).size === xs.length, 'Duplicate assessed attempt') }).strict();
export const recommendRequestSchema = profileRequestSchema.extend({
  profile: profileSchema,
  enabledChannels: z.array(channelSchema).min(1).max(channels.length).refine((x) => new Set(x).size === x.length),
  profession: z.string().nullable(),
  interests: z.array(z.string()),
  candidatePatterns: z.array(patternSchema).min(1).refine((xs) => new Set(xs.map((x) => x.id)).size === xs.length, 'Duplicate pattern'),
  recentPatternIds: z.array(uuidSchema).max(3),
  randomSeed: z.number().int().min(0).max(2147483647),
});
export const recommendationSchema = z.object({
  patternId: uuidSchema,
  channel: channelSchema,
  difficulty: difficultySchema,
  targetedTactics: z.array(tacticSchema),
  explanation: z.string().min(1),
  engineVersion: z.literal('rules-v1'),
  randomSeed: z.number().int().min(0).max(2147483647),
}).strict();
export type Pattern = z.infer<typeof patternSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type RecommendRequest = z.infer<typeof recommendRequestSchema>;
