import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import * as authService from './service'
import { AuthContext, type AuthOperation } from './AuthContext'
import { getAuthErrorMessage, PasswordPolicyError } from './errors'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [pending, setPending] = useState<AuthOperation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [profileWarning, setProfileWarning] = useState<string | null>(null)
  const busy = useRef(false)

  useEffect(() => authService.observeAuthState(
    (nextUser) => {
      setUser(nextUser)
      setInitializing(false)
    },
    (authError) => {
      setError(getAuthErrorMessage(authError))
      setInitializing(false)
    },
  ), [])

  const clearError = useCallback(() => {
    setError(null)
    setPasswordError(null)
  }, [])

  async function run(operation: AuthOperation, action: () => Promise<void>) {
    if (busy.current) return false
    busy.current = true
    setPending(operation)
    clearError()
    try {
      await action()
      return true
    } catch (actionError) {
      if (actionError instanceof PasswordPolicyError) setPasswordError(actionError.message)
      else setError(getAuthErrorMessage(actionError))
      return false
    } finally {
      busy.current = false
      setPending(null)
    }
  }

  return (
    <AuthContext.Provider value={{
      user, initializing, pending, error, passwordError, profileWarning, clearError,
      login: (email, password) => run('login', async () => {
        const result = await authService.signIn(email, password)
        setUser(result.user)
      }),
      register: (email, password, name) => run('signup', async () => {
        const result = await authService.signUp(email, password, name)
        setProfileWarning(result.profileWarning)
        setUser(result.credential.user)
      }),
      google: () => run('google', async () => {
        const result = await authService.signInWithGoogle()
        setUser(result.user)
      }),
      recoverPassword: (email) => run('reset', () => authService.resetPassword(email)),
      logout: () => run('signout', async () => {
        await authService.signOut()
        setUser(null)
        setProfileWarning(null)
      }),
    }}>
      {children}
    </AuthContext.Provider>
  )
}
