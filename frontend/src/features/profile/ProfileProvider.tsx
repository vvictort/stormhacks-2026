import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import type { UserProfile } from '../auth/types'
import { api } from '../../lib/api'
import { ProfileContext } from './ProfileContext'

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth()
  const uid = user?.uid
  const [state, setState] = useState<{
    uid?: string
    profile: UserProfile | null
    loading: boolean
    error: string | null
  }>({ profile: null, loading: true, error: null })
  const [retryCount, setRetryCount] = useState(0)
  useEffect(() => {
    if (!uid || initializing) return
    const controller = new AbortController()
    api<UserProfile>('/users/me', { signal: controller.signal }, uid)
      .then((profile) => {
        if (!controller.signal.aborted) {
          setState({ uid, profile, loading: false, error: null })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({
            uid,
            profile: null,
            loading: false,
            error: 'We couldn’t load your profile. Please try again.',
          })
        }
      })
    return () => controller.abort()
  }, [uid, initializing, retryCount])
  const matches = state.uid === uid
  return (
    <ProfileContext.Provider
      value={{
        profile: uid && matches ? state.profile : null,
        loading: Boolean(uid) && (initializing || !matches || state.loading),
        error: uid && matches ? state.error : null,
        retry: () => {
          setState({ uid, profile: null, loading: true, error: null })
          setRetryCount((count) => count + 1)
        },
        save: async (input) => {
          if (!uid) throw new Error('Not signed in')
          const profile = await api<UserProfile>(
            '/users/me',
            { method: 'PUT', body: JSON.stringify(input) },
            uid,
          )
          setState({ uid, profile, loading: false, error: null })
        },
      }}
    >
      {children}
    </ProfileContext.Provider>
  )
}
