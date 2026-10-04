import { LoaderCircle } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { resolveGuestRoute, resolveProtectedRoute } from './redirect'
import { useProfile } from '../profile/ProfileContext'

export function RequireAuth() {
  const { user, initializing, pending, logout } = useAuth()
  const { profile, loading, error, retry } = useProfile()
  const location = useLocation()
  const decision = resolveProtectedRoute(
    { initializing, signedIn: Boolean(user), pending },
    location.pathname + location.search + location.hash,
  )

  if (decision.kind === 'loading' || (decision.kind === 'render' && loading)) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background" aria-busy="true">
        {/* .session-loading stays hidden for 350ms, so fast session checks never flash a loader. */}
        <div className="session-loading" role="status"><LoaderCircle className="spinner text-primary" size={26} aria-hidden="true" /><span className="sr-only">Checking your session</span></div>
      </main>
    )
  }
  if (decision.kind === 'redirect') return <Navigate to={decision.to} replace state={decision.from ? { from: decision.from } : undefined} />
  if (error) return <main className="profile-error"><p role="alert">{error}</p><button className="primary-button" onClick={retry}>Retry loading profile</button><button className="text-link" disabled={Boolean(pending)} onClick={() => void logout()}>Sign out</button></main>
  if (!profile?.onboardingComplete && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />
  return <Outlet />
}

export function RedirectIfAuthed() {
  const { user, initializing, pending } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: unknown } | null)?.from
  const decision = resolveGuestRoute({ initializing, signedIn: Boolean(user), pending, from })

  if (decision.kind === 'redirect') return <Navigate to={decision.to} replace />
  return <Outlet />
}
