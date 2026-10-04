import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { resolveGuestRoute, resolveProtectedRoute } from './redirect'

export function RequireAuth() {
  const { user, initializing, pending } = useAuth()
  const location = useLocation()
  const decision = resolveProtectedRoute(
    { initializing, signedIn: Boolean(user), pending },
    location.pathname + location.search + location.hash,
  )

  if (decision.kind === 'loading') {
    return (
      <main className="grid min-h-dvh place-items-center bg-background text-muted-strong" aria-busy="true">
        <p role="status">Checking your session…</p>
      </main>
    )
  }
  if (decision.kind === 'redirect') return <Navigate to={decision.to} replace state={decision.from ? { from: decision.from } : undefined} />
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
