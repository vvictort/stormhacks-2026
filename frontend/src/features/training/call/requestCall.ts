import { api } from '../../../lib/api'
import { saveCachedScenarioMeta } from '../scenarioCache'

// Outside the lazy call chunk on purpose: safe to import from the main bundle (Home). Never import `@elevenlabs/react`
// or `useSimulatedCall` here.

/** `POST /api/training/call-scenarios` 201 (docs/call-integration.md). */
export interface CreatedCallScenario {
  scenarioId: string
  title: string
  callerLabel: string
  difficulty: 'easy' | 'medium' | 'hard'
  tactics: string[]
  source: 'gemini' | 'fallback'
}

/**
 * Asks the backend for a call written for this user's training profile and resolves with its id (`gen-call-…`);
 * navigate to `/train/${id}` to ring it. Rejects on any failure, including the rate limit (the message names the
 * status, e.g. 429), so the caller can fall back to a built-in call.
 */
export async function requestPersonalisedCall(signal?: AbortSignal, expectedUid?: string): Promise<string> {
  const created = await api<CreatedCallScenario>('/training/call-scenarios', { method: 'POST', body: '{}', signal }, expectedUid)
  saveCachedScenarioMeta({
    id: created.scenarioId,
    title: created.title || 'Personalised scam call',
    summary: `${created.callerLabel} · Interactive voice scam simulation`,
    type: 'call',
    difficulty: created.difficulty,
  })
  return created.scenarioId
}
