import { z } from 'zod';

// The canonical words shared with comms and the frontend; see docs/call-integration.md.
export const Channel = z.enum(['sms', 'email', 'call']);
export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export const Outcome = z.enum(['resisted', 'compromised', 'declined', 'missed', 'error']);
export const Tactic = z.enum(['urgency', 'authority', 'suspicious_link', 'otp_request', 'info_request', 'reward', 'fear']);

export type Channel = z.infer<typeof Channel>;
export type Difficulty = z.infer<typeof Difficulty>;
export type Outcome = z.infer<typeof Outcome>;
export type Tactic = z.infer<typeof Tactic>;
