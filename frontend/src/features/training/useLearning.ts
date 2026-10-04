import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { Metrics } from '../insights/instincts'
import { insightSource } from '../insights/scamProfile'
import { readAdaptive, type Snapshot } from './adaptive'

// Snowflake (a cold warehouse, then Cortex) can be slow: the debrief waits this
// long for the analysis, then shows without it. The server finishes and caches
// it either way.
const INSIGHTS_BUDGET_MS = 6000

/**
 * Progress (difficulty, focus), metrics (TigerData) and the analysis
 * (Snowflake or built-in); any part can be null.
 */
async function snapshot(uid: string, signal: AbortSignal): Promise<Snapshot> {
  // In parallel: progress reports the same deterministic focus whether or not
  // the analysis has refreshed.
  const [insights, progress, metrics] = await Promise.all([
    api<{
      behavioralPattern?: unknown
      source?: unknown
      basedOn?: { attempts?: number }
    }>(
      '/training/insights',
      {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(INSIGHTS_BUDGET_MS),
        ]),
      },
      uid,
    ).catch(() => null),
    api<unknown>('/training/progress', { signal }, uid).catch(() => null),
    api<Metrics>('/training/metrics', { signal }, uid).catch(() => null),
  ])
  signal.throwIfAborted()

  return {
    adaptive: readAdaptive(progress),
    metrics: metrics && typeof metrics.attempts === 'number' ? metrics : null,
    insight:
      insights &&
      typeof insights.behavioralPattern === 'string' &&
      insights.basedOn?.attempts
        ? {
            pattern: insights.behavioralPattern,
            source: insightSource(insights.source),
          }
        : null,
  }
}

export type Learning =
  | { status: 'loading' }
  /**
   * The state before the run couldn't be read: nothing honest to compare, so
   * the panel hides.
   */
  | { status: 'off' }
  | { status: 'waiting'; before: Snapshot }
  | { status: 'ready'; before: Snapshot; after: Snapshot }
  | { status: 'stale'; before: Snapshot }

const POLL_MS = 1500
const TRIES = 7

/**
 * Reads the adaptive state when a run opens, and again once `attemptId` (the
 * finished run) is on the server: texts and emails arrive with the tracker's
 * flush, calls after the server analyses them, so it polls lightly until it's
 * there.
 */
export function useLearning(
  uid: string | null | undefined,
  attemptId: string | null,
): Learning {
  const [before, setBefore] = useState<Snapshot | null | undefined>()
  const [after, setAfter] = useState<{ id: string; snap: Snapshot | null }>()

  useEffect(() => {
    if (!uid) return
    const controller = new AbortController()
    snapshot(uid, controller.signal)
      .then((snap) => setBefore(snap.adaptive ? snap : null))
      .catch(() => {
        if (!controller.signal.aborted) setBefore(null)
      })
    return () => controller.abort()
  }, [uid])

  useEffect(() => {
    if (!uid || !attemptId || !before) return
    const controller = new AbortController()
    void (async () => {
      for (let i = 0; i < TRIES; i++) {
        const snap = await snapshot(uid, controller.signal).catch(() => null)
        if (controller.signal.aborted) return
        if (snap?.adaptive?.attempts.some((a) => a.id === attemptId)) {
          return setAfter({ id: attemptId, snap })
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
      if (!controller.signal.aborted) setAfter({ id: attemptId, snap: null })
    })()
    return () => controller.abort()
  }, [uid, attemptId, before])

  if (before === undefined) return { status: 'loading' }
  if (before === null) return { status: 'off' }
  if (!attemptId || after?.id !== attemptId) {
    return { status: 'waiting', before }
  }
  return after.snap
    ? { status: 'ready', before, after: after.snap }
    : { status: 'stale', before }
}
