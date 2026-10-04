import { createContext, useContext } from 'react'
import type { ProfileInput, UserProfile } from '../auth/types'
export interface ProfileContextValue {
  profile: UserProfile | null
  loading: boolean
  error: string | null
  retry: () => void
  save: (input: ProfileInput) => Promise<void>
}
export const ProfileContext = createContext<ProfileContextValue | null>(null)
export function useProfile() {
  const value = useContext(ProfileContext)
  if (!value) throw new Error('useProfile must be used inside ProfileProvider')
  return value
}
