import type { Recommendation } from '../schemas/personalization.js';
import type { Scenario } from '../schemas/attempt.js';
export type { Assessment, HistoryEntry } from '../schemas/attempt.js';
export interface Attempt {
  id: string;
  userId: string;
  sessionId: string;
  patternId: string;
  channel: 'text' | 'email' | 'call';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  status: 'reserved' | 'ready' | 'active' | 'awaiting_feedback' | 'completed' | 'abandoned' | 'generation_failed';
  recommendation: Recommendation;
  scenario: Scenario | null;
  createdAt: string;
}
