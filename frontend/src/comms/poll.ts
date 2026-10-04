import { CommsError, isAbortError } from './client'
import type { CallRecord } from './types'

// Waiting for a call's post-call analysis. The fetcher is injected so this
// stays framework-free and testable in Node.

export const ANALYSIS_POLL_DELAYS_MS = [1500, 2000, 3000, 5000]
export const ANALYSIS_TIMEOUT_MS = 150_000

/**
 * Resolves after `ms`, or rejects with `signal.reason` once the signal aborts.
 */
export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// Network failures and 5xx are worth another try; 4xx and aborts are not.
const isTransient = (error: unknown) =>
  error instanceof CommsError ? error.status >= 500 : !isAbortError(error)

export interface PollOptions {
  signal?: AbortSignal
  onRecord?: (record: CallRecord) => void
  delaysMs?: number[]
  timeoutMs?: number
}

/**
 * Re-fetches a call (waiting before each fetch; the last delay repeats) until
 * it is `completed`, passing every record to `onRecord`. Throws
 * `CommsError(504, 'analysis_timeout')` once `timeoutMs` has passed.
 */
export async function pollUntilCompleted(
  getCall: (callId: string, signal?: AbortSignal) => Promise<CallRecord>,
  callId: string,
  {
    signal,
    onRecord,
    delaysMs = ANALYSIS_POLL_DELAYS_MS,
    timeoutMs = ANALYSIS_TIMEOUT_MS,
  }: PollOptions = {},
): Promise<CallRecord> {
  const deadline = Date.now() + timeoutMs
  for (let attempt = 0; ; attempt++) {
    await sleep(delaysMs[Math.min(attempt, delaysMs.length - 1)], signal)
    let record: CallRecord | null = null
    try {
      record = await getCall(callId, signal)
    } catch (error) {
      if (!isTransient(error)) throw error
    }
    if (record) {
      onRecord?.(record)
      if (record.status === 'completed') return record
    }
    if (Date.now() >= deadline) throw new CommsError(504, 'analysis_timeout')
  }
}
