import { z } from 'zod';

export const channels = ['text', 'email', 'call'] as const;
export const tactics = ['urgency', 'authority', 'suspicious_links', 'otp_requests', 'information_sharing'] as const;
export const difficulties = ['beginner', 'intermediate', 'advanced'] as const;
export const channelSchema = z.enum(channels);
export const tacticSchema = z.enum(tactics);
export const difficultySchema = z.enum(difficulties);
export const kindSchema = z.enum(['scam', 'legitimate']);
export const uuidSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export type Channel = z.infer<typeof channelSchema>;
export type Tactic = z.infer<typeof tacticSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export type Kind = z.infer<typeof kindSchema>;
