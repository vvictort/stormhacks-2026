import { createContext, useContext } from 'react'
import type { User } from 'firebase/auth'

export type AuthOperation = 'login' | 'signup' | 'google' | 'reset' | 'signout'

export interface AuthContextValue {
  user: User | null
  initializing: boolean
  pending: AuthOperation | null
  error: string | null
  passwordError: string | null
  /**
   * Set when signup created the account but couldn't save the name. Survives
   * the redirect to /home; cleared on sign-out.
   */
  profileWarning: string | null
  clearError: () => void
  dismissProfileWarning: () => void
  login: (email: string, password: string) => Promise<boolean>
  register: (email: string, password: string, name: string) => Promise<boolean>
  google: () => Promise<boolean>
  recoverPassword: (email: string) => Promise<boolean>
  logout: () => Promise<boolean>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
