import type { EmailScenario, SmsScenario } from './scenarios.ts'

/** The authenticated client from `lib/api.ts` (passed in, so this stays testable in Node). */
type Api = <T>(path: string, init?: RequestInit) => Promise<T>

/**
 * Asks the backend for a scenario written for this user's profile and history; the server reads the profile itself,
 * so the body is empty. Fails with a message fit to show as is.
 */
export async function generateScenario(api: Api, channel?: 'email'): Promise<EmailScenario>
export async function generateScenario(api: Api, channel: 'sms'): Promise<SmsScenario>
export async function generateScenario(api: Api, channel: 'email' | 'sms'): Promise<EmailScenario | SmsScenario>
export async function generateScenario(api: Api, channel: 'email' | 'sms' = 'email'): Promise<EmailScenario | SmsScenario> {
  try {
    const { scenario } = await api<{ scenario: EmailScenario | SmsScenario }>(`/training/${channel}-scenarios`, { method: 'POST', body: '{}' })
    if (!scenario?.id?.startsWith(`gen-${channel}-`)) throw new Error('Unexpected response')
    return scenario
  } catch (error) {
    // lib/authenticatedRequest reports the status at the end of the message.
    throw new Error(/ 429$/.test((error as Error)?.message ?? '')
      ? `You've made a lot of practice ${channel === 'sms' ? 'messages' : 'emails'} just now. Take a short break, then try again.`
      : `We couldn't write a new ${channel === 'sms' ? 'text message' : 'email'} just now. Try again in a moment, or pick a scenario from your path.`, { cause: error })
  }
}
