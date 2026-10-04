import type {
  AcceptCallResponse,
  CallRecord,
  Channel,
  DeclineReason,
  ScenarioPick,
  ScenarioSummary,
  StartCallResponse,
  StartTextResponse,
  StartTextResult,
  TextMessage,
  TextThread,
} from './types'

// Typed HTTP client for the API's /api/comms routes (simulated texts and calls). Framework-free (no React, no Firebase)
// so it can be unit tested in Node with a fake fetch.

export class CommsError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, details?: unknown) {
    super(`comms request failed: ${code} (${status})`)
    this.name = 'CommsError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface CommsClientOptions {
  /** e.g. `/api/comms` (same origin; the Vite proxy in dev). */
  baseUrl: string
  /** Firebase ID token; `forceRefresh` is true when retrying after a 401. */
  getToken: (forceRefresh: boolean) => Promise<string>
  fetch?: typeof fetch
}

interface RequestOptions {
  body?: unknown
  signal?: AbortSignal
  auth?: boolean
}

const enc = encodeURIComponent

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** The API's error body is `{ error: { code, message, ...details } }`. */
const errorBody = (data: unknown) => (isRecord(data) && isRecord(data.error) ? data.error : null)

function errorCode(data: unknown, status: number) {
  const code = errorBody(data)?.code
  return typeof code === 'string' ? code : `http_${status}`
}

export function createCommsClient({
  baseUrl,
  getToken,
  fetch: doFetch = globalThis.fetch.bind(globalThis),
}: CommsClientOptions) {
  const base = baseUrl.replace(/\/+$/, '')

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    { body, signal, auth = true }: RequestOptions = {},
  ): Promise<T> {
    const send = async (forceRefresh: boolean) => {
      const headers: Record<string, string> = {}
      if (auth) headers.authorization = `Bearer ${await getToken(forceRefresh)}`
      // The API takes writes only as JSON (with the browser's own Origin), so every POST carries a body.
      if (method === 'POST') headers['content-type'] = 'application/json'
      return doFetch(base + path, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal,
      })
    }

    let res = await send(false)
    if (res.status === 401 && auth) {
      // The cached ID token may have expired or been revoked: retry once with a fresh one.
      res.body?.cancel().catch(() => {})
      res = await send(true)
    }

    const data: unknown = await res.json().catch(() => null)
    signal?.throwIfAborted()
    if (!res.ok) throw new CommsError(res.status, errorCode(data, res.status), data)
    if (data === null) throw new CommsError(res.status, 'invalid_response')
    return data as T
  }

  return {
    async listScenarios(channel?: Channel, signal?: AbortSignal): Promise<ScenarioSummary[]> {
      const query = channel ? `?channel=${enc(channel)}` : ''
      const data = await request<{ scenarios?: ScenarioSummary[] }>('GET', `/scenarios${query}`, { signal, auth: false })
      return data.scenarios ?? []
    },

    /** Starts a text thread, or resumes the user's active one (`resumed: true`). */
    async startText(pick: ScenarioPick = {}, signal?: AbortSignal): Promise<StartTextResult> {
      try {
        const { threadId } = await request<StartTextResponse>('POST', '/texts', { body: pick, signal })
        return { threadId, resumed: false }
      } catch (error) {
        if (error instanceof CommsError && error.status === 409 && error.code === 'active_thread_exists') {
          const threadId = errorBody(error.details)?.threadId
          if (typeof threadId === 'string' && threadId) return { threadId, resumed: true }
        }
        throw error
      }
    },

    getThread: (threadId: string, signal?: AbortSignal) =>
      request<TextThread>('GET', `/texts/${enc(threadId)}`, { signal }),

    /** Resolves with the stored (redacted) copy of the user's message. */
    async reply(threadId: string, body: string, signal?: AbortSignal): Promise<TextMessage> {
      const data = await request<{ message: TextMessage }>('POST', `/texts/${enc(threadId)}/replies`, { body: { body }, signal })
      return data.message
    },

    report: (threadId: string, signal?: AbortSignal) =>
      request<TextThread>('POST', `/texts/${enc(threadId)}/report`, { signal }),

    /** SSE URL with the ID token in the query (EventSource can't send headers). Build a fresh one per connection. */
    streamUrl: async (threadId: string) =>
      `${base}/texts/${enc(threadId)}/stream?access_token=${enc(await getToken(false))}`,

    /** Call scenarios are server-owned: the body is `{ scenarioId }` and nothing else. */
    startCall: (scenarioId: string, signal?: AbortSignal) =>
      request<StartCallResponse>('POST', '/calls', { body: { scenarioId }, signal }),

    getCall: (callId: string, signal?: AbortSignal) =>
      request<CallRecord>('GET', `/calls/${enc(callId)}`, { signal }),

    acceptCall: (callId: string, signal?: AbortSignal) =>
      request<AcceptCallResponse>('POST', `/calls/${enc(callId)}/accept`, { signal }),

    declineCall: (callId: string, reason: DeclineReason, signal?: AbortSignal) =>
      request<CallRecord>('POST', `/calls/${enc(callId)}/decline`, { body: { reason }, signal }),

    /** Ringing only: gives the call up (caption practice, leaving the page). The server closes it unscored and never saves it. */
    abandonCall: (callId: string, signal?: AbortSignal) =>
      request<CallRecord>('POST', `/calls/${enc(callId)}/abandon`, { signal }),

    /** Binds the voice session's conversation id; a different id than the bound one is `409 conversation_mismatch`. */
    callConnected: (callId: string, conversationId: string, signal?: AbortSignal) =>
      request<CallRecord>('POST', `/calls/${enc(callId)}/connected`, { body: { conversationId }, signal }),

    callEnded: (callId: string, conversationId?: string, signal?: AbortSignal) =>
      request<CallRecord>('POST', `/calls/${enc(callId)}/ended`, {
        body: conversationId ? { conversationId } : {},
        signal,
      }),
  }
}

export type CommsClient = ReturnType<typeof createCommsClient>

export const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

/** Stable error code for UI copy: the server's `error` code, or `network_error`. */
export const describeError = (error: unknown) =>
  error instanceof CommsError ? error.code : 'network_error'
