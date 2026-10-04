import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { scamProfileView, type ScamProfileView } from './scamProfile.ts'

export type ScamProfileState = { status: 'loading' } | { status: 'ready'; view: ScamProfileView } | { status: 'error' }

/** The account's vulnerability analysis; refetched whenever a page using it mounts. */
export function useScamProfile(uid: string | null | undefined): ScamProfileState {
  const [state, setState] = useState<{ uid?: string | null; value: ScamProfileState }>({ value: { status: 'loading' } })
  useEffect(() => {
    if (!uid) return
    const controller = new AbortController()
    api<unknown>('/training/insights', { signal: controller.signal }, uid)
      .then((data) => {
        const view = scamProfileView(data)
        if (!controller.signal.aborted) setState({ uid, value: view ? { status: 'ready', view } : { status: 'error' } })
      })
      .catch(() => { if (!controller.signal.aborted) setState({ uid, value: { status: 'error' } }) })
    return () => controller.abort()
  }, [uid])
  return state.uid === uid ? state.value : { status: 'loading' }
}
