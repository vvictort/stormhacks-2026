import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { comms } from './api'
import { CommsError, describeError, isAbortError } from './client'
import {
  initialThreadState,
  parseThreadEvent,
  threadReducer,
  threadStatus,
  type TextThreadStatus,
  type ThreadAction,
} from './threadState'
import type { Outcome, TextMessage, ThreadEndReason } from './types'

export interface TextThreadHandle {
  status: TextThreadStatus
  messages: TextMessage[]
  /** Scammer is "typing". */
  typing: boolean
  outcome: Outcome | null
  endReason: ThreadEndReason | null
  /** A reply is in flight. */
  sending: boolean
  error: string | null
  /** Resolves with the stored (redacted) copy, or null if it failed (see `error`). */
  send: (body: string) => Promise<TextMessage | null>
  report: () => Promise<boolean>
  /** Retry after a fatal connection error. */
  reconnect: () => void
}

/** Backoff for reopening the stream after the server refused it (expired token, restart, ...). */
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 20_000]
const EVENTS = ['message', 'typing', 'ended'] as const

/** Live view of one simulated text thread over SSE; `threadId` null means no thread. */
export function useTextThread(threadId: string | null): TextThreadHandle {
  const [state, dispatch] = useReducer(
    threadReducer,
    threadId,
    initialThreadState,
  )
  const [generation, setGeneration] = useState(0)
  const latestThreadId = useRef(threadId)

  // The reducer only switches threads on an action for the new one, so derive a fresh view until then.
  const view =
    state.threadId === threadId ? state : initialThreadState(threadId)

  useEffect(() => {
    latestThreadId.current = threadId
  }, [threadId])

  useEffect(() => {
    if (!threadId) return
    const id = threadId
    const abort = new AbortController()
    let disposed = false
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0

    const fail = (error: string) =>
      dispatch({ type: 'error', threadId: id, error, fatal: true })

    async function connect() {
      let url: string
      try {
        url = await comms.streamUrl(id)
      } catch (error) {
        if (disposed) return
        if (error instanceof CommsError) fail(error.code)
        else recover()
        return
      }
      if (disposed) return

      const es = new EventSource(url)
      source = es
      es.onopen = () => {
        if (disposed) return
        failures = 0
        dispatch({ type: 'connection', threadId: id, connection: 'open' })
      }
      for (const name of EVENTS) {
        es.addEventListener(name, (event) => {
          const action = parseThreadEvent(name, event.data, id)
          if (disposed || !action) return
          dispatch(action)
          if (name === 'ended') es.close()
        })
      }
      es.onerror = () => {
        if (disposed) return
        // CONNECTING: the browser retries by itself and replays from Last-Event-ID (deduped by the reducer).
        // CLOSED: the server answered with an error (401 expired token in the URL, 404, ...).
        if (es.readyState === EventSource.CONNECTING) {
          dispatch({
            type: 'connection',
            threadId: id,
            connection: 'reconnecting',
          })
        } else if (es.readyState === EventSource.CLOSED) {
          es.close()
          recover()
        }
      }
    }

    function recover() {
      if (disposed) return
      if (failures >= RETRY_DELAYS_MS.length) {
        fail('connection_lost')
        return
      }
      const delay = RETRY_DELAYS_MS[failures++]
      dispatch({ type: 'connection', threadId: id, connection: 'reconnecting' })
      timer = setTimeout(async () => {
        try {
          // Authenticated with a header, so the client refreshes an expired token for us.
          const thread = await comms.getThread(id, abort.signal)
          if (disposed) return
          dispatch({ type: 'snapshot', threadId: id, thread })
          if (thread.status === 'active') void connect()
        } catch (error) {
          if (disposed || isAbortError(error)) return
          if (
            error instanceof CommsError &&
            (error.status === 404 || error.status === 401)
          ) {
            fail(error.code)
          } else recover()
        }
      }, delay)
    }

    void connect()
    return () => {
      disposed = true
      clearTimeout(timer)
      source?.close()
      abort.abort()
    }
  }, [threadId, generation])

  // Results of sends/reports for a thread we've since left are dropped (the reducer would reset to it).
  const dispatchCurrent = useCallback((action: ThreadAction) => {
    if (action.threadId === latestThreadId.current) dispatch(action)
  }, [])

  const send = useCallback(
    async (body: string) => {
      if (!threadId || !body.trim()) return null
      const id = threadId
      dispatchCurrent({ type: 'send', threadId: id, phase: 'start' })
      try {
        // No optimistic copy: the server stores a redacted version. The SSE echo is deduped by id.
        const message = await comms.reply(id, body)
        dispatchCurrent({ type: 'message', threadId: id, message })
        return message
      } catch (error) {
        dispatchCurrent({
          type: 'error',
          threadId: id,
          error: describeError(error),
          fatal: false,
        })
        return null
      } finally {
        dispatchCurrent({ type: 'send', threadId: id, phase: 'done' })
      }
    },
    [threadId, dispatchCurrent],
  )

  const report = useCallback(async () => {
    if (!threadId) return false
    const id = threadId
    try {
      const thread = await comms.report(id)
      dispatchCurrent({ type: 'snapshot', threadId: id, thread })
      return true
    } catch (error) {
      dispatchCurrent({
        type: 'error',
        threadId: id,
        error: describeError(error),
        fatal: false,
      })
      return false
    }
  }, [threadId, dispatchCurrent])

  const reconnect = useCallback(() => {
    if (!threadId) return
    dispatchCurrent({
      type: 'connection',
      threadId,
      connection: 'reconnecting',
    })
    setGeneration((g) => g + 1)
  }, [threadId, dispatchCurrent])

  return {
    status: threadStatus(view),
    messages: view.messages,
    typing: view.typing,
    outcome: view.outcome,
    endReason: view.endReason,
    sending: view.pendingSends > 0,
    error: view.error,
    send,
    report,
    reconnect,
  }
}
