import { z } from 'zod';
import { timestampSchema, uuidSchema } from './domain.js';

export const messageSchema = z.object({
  id: uuidSchema,
  role: z.enum(['user', 'simulation']),
  content: z.string().trim().min(1).max(10000),
  occurredAt: timestampSchema,
}).strict();
export const eventSchema = z.object({
  eventId: uuidSchema,
  action: z.enum(['opened', 'replied', 'clicked_link', 'shared_otp', 'shared_information', 'reported', 'accepted', 'call_answered', 'call_ended']),
  occurredAt: timestampSchema,
  metadata: z.object({
    messageId: uuidSchema.optional(),
    responseTimeMs: z.number().int().min(0).optional(),
    target: z.string().max(1000).optional(),
  }).strict().default({}),
}).strict();
export type Message = z.infer<typeof messageSchema>;
export type BehavioralEvent = z.infer<typeof eventSchema>;
