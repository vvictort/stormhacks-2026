import type { AuthOperation } from './AuthContext'

export interface AuthRouteState {
  initializing: boolean
  signedIn: boolean
  pending: AuthOperation | null
  /** Where a logged-out visitor was heading, from `location.state.from`. */
  from?: unknown
}

export type AuthRouteDecision =
  | { kind: 'loading' }
  | { kind: 'render' }
  | { kind: 'redirect'; to: string; from?: string }

/** Accepts only in-app paths, so `state.from` can never send the user off-site or back to an auth page. */
export function safeReturnPath(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return '/home'
  if (/^\/(login|signup)?(?:[/?#]|$)/.test(from)) return '/home'
  return from
}

/** Pages that need a signed-in user. `here` is the current path, remembered for after login. */
export function resolveProtectedRoute(state: AuthRouteState, here: string): AuthRouteDecision {
  if (state.initializing) return { kind: 'loading' }
  if (state.signedIn) return { kind: 'render' }
  // An explicit sign-out lands on a plain /login; anything else remembers the destination.
  return state.pending === 'signout' ? { kind: 'redirect', to: '/login' } : { kind: 'redirect', to: '/login', from: here }
}

/** Login and signup. While initializing the auth form shows its own session check, so render it. */
export function resolveGuestRoute(state: AuthRouteState): AuthRouteDecision {
  // Wait for the whole operation to settle (signup saves the name after Firebase signs in).
  if (state.initializing || !state.signedIn || state.pending) return { kind: 'render' }
  return { kind: 'redirect', to: safeReturnPath(state.from) }
}
