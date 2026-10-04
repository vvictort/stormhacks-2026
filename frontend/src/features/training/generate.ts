import type { EmailScenario } from './scenarios.ts'

/** The authenticated client from `lib/api.ts` (passed in, so this stays testable in Node). */
type Api = <T>(path: string, init?: RequestInit) => Promise<T>

/**
 * Asks the backend for a scenario written for this user's profile and history; the server reads the profile itself,
 * so the body is empty. Fails with a message fit to show as is.
 */
export async function generateScenario(api: Api, channel: 'email' = 'email'): Promise<EmailScenario> {
  try {
    const { scenario } = await api<{ scenario: EmailScenario }>(`/training/${channel}-scenarios`, { method: 'POST', body: '{}' })
    if (!scenario?.id?.startsWith(`gen-${channel}-`)) throw new Error('Unexpected response')
    return scenario
  } catch (error) {
    // lib/authenticatedRequest reports the status at the end of the message.
    throw new Error(/ 429$/.test((error as Error)?.message ?? '')
      ? "You've made a lot of practice emails just now. Take a short break, then try again."
      : "We couldn't write a new email just now. Try again in a moment, or choose a practice scenario from the Library.", { cause: error })
  }
}
