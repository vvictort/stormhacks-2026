import { z } from 'zod';
import { channelSchema, timestampSchema, uuidSchema } from './domain.js';

export const preferencesSchema = z.object({
  name: z.string().trim().min(1).max(100),
  profession: z.string().trim().max(200).nullable().default(null),
  interests: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  enabledChannels: z.array(channelSchema).min(1).max(3).refine((xs) => new Set(xs).size === xs.length, 'Channels must be unique'),
}).strict();
export const userSchema = preferencesSchema.extend({ id: uuidSchema, createdAt: timestampSchema });
export type Preferences = z.infer<typeof preferencesSchema>;
export type User = z.infer<typeof userSchema>;
