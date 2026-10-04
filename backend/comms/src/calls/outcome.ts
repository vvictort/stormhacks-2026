import type { CallScenario, CallTraining, Outcome } from '../types.ts';

// The contract table in docs/call-integration.md. Every call scenario is a scam, so anything short of
// compromised (declining, missing, hanging up) counts as a success.
const CANONICAL: Record<Outcome, Pick<CallTraining, 'outcome' | 'success'>> = {
  compromised: { outcome: 'compromised', success: false },
  resisted: { outcome: 'resisted', success: true },
  reported: { outcome: 'resisted', success: true },
  declined: { outcome: 'declined', success: true },
  ignored: { outcome: 'missed', success: true },
  missed: { outcome: 'missed', success: true },
  error: { outcome: 'error', success: null },
};

export const DIFFICULTY = { 1: 'easy', 2: 'medium', 3: 'hard' } as const satisfies Record<CallScenario['difficulty'], CallTraining['difficulty']>;

export const toTraining = (outcome: Outcome, difficulty: CallScenario['difficulty']): CallTraining => ({
  ...CANONICAL[outcome],
  difficulty: DIFFICULTY[difficulty],
});
