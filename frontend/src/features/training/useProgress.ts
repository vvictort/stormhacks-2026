import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { readAdaptive, type Adaptive } from './adaptive.ts'
import { loadProgress, mergeProgress, recordAttempt, saveProgress, type ServerAttempt } from './progress.ts'

/** Where live-call results come from right now: the backend, or (when it can't be reached) nothing beyond local practice. */
export type CallSync = 'loading' | 'synced' | 'unavailable'

/** The account's attempts and adaptive state (difficulty, focus) from the backend; refetched whenever a page using it mounts. */
function useServerAttempts(uid: string | null | undefined) {
  const [state, setState] = useState<{ uid?: string | null; attempts: ServerAttempt[]; adaptive: Adaptive | null; sync: CallSync }>({ attempts: [], adaptive: null, sync: 'loading' })
  useEffect(() => {
    if (!uid) return
    const controller = new AbortController()
    api<{ attempts?: unknown }>('/training/progress', { signal: controller.signal }, uid)
      .then((data) => {
        if (!controller.signal.aborted) setState({ uid, attempts: Array.isArray(data.attempts) ? data.attempts as ServerAttempt[] : [], adaptive: readAdaptive(data), sync: 'synced' })
      })
      .catch(() => {
        // Backend down or the route not there yet: local practice results still count.
        if (!controller.signal.aborted) setState({ uid, attempts: [], adaptive: null, sync: 'unavailable' })
      })
    return () => controller.abort()
  }, [uid])
  return state.uid === uid ? state : { attempts: [], adaptive: null, sync: 'loading' as const }
}

export function useProgress(uid: string | null | undefined) {
  const [state, setState] = useState(() => ({ uid, progress: loadProgress(uid) }))
  const server = useServerAttempts(uid)
  let current = state
  // The signed-in user can arrive after first render; reload for the new account.
  if (state.uid !== uid) {
    current = { uid, progress: loadProgress(uid) }
    setState(current)
  }

  /** Saves a local result: texts, emails and call practice mode. Live calls are recorded by the backend. */
  function record(id: string, correct: boolean) {
    const progress = recordAttempt(current.progress, id, correct)
    saveProgress(uid, progress)
    setState({ uid, progress })
  }

  return { progress: mergeProgress(current.progress, server.attempts), record, callSync: server.sync, adaptive: server.adaptive }
}
