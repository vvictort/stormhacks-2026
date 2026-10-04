import { z } from 'zod';
import { Tactic, type Difficulty } from '../shared/vocabulary.ts';

// The API's own copy of comms' CallScenario (backend/comms/src/types.ts), so the services share a contract, not code.
// tests/call-scenario.test.ts parses every comms call fixture with it to catch drift.
export const CallScenario = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tactics: z.array(Tactic).min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  callerLabel: z.string().min(1),
  systemPrompt: z.string().min(1),
  firstMessage: z.string().min(1),
  voiceId: z.string().min(1).optional(),
});
export type CallScenario = z.infer<typeof CallScenario>;

export const difficultyName: Record<CallScenario['difficulty'], Difficulty> = { 1: 'easy', 2: 'medium', 3: 'hard' };
