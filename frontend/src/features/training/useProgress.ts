import { useState } from 'react'
import { loadProgress, recordAttempt, saveProgress } from './progress.ts'

export function useProgress(uid: string | null | undefined) {
  const [state, setState] = useState(() => ({ uid, progress: loadProgress(uid) }))
  let current = state
  // The signed-in user can arrive after first render; reload for the new account.
  if (state.uid !== uid) {
    current = { uid, progress: loadProgress(uid) }
    setState(current)
  }

  function record(id: string, correct: boolean) {
    const progress = recordAttempt(current.progress, id, correct)
    saveProgress(uid, progress)
    setState({ uid, progress })
  }

  return { progress: current.progress, record }
}
