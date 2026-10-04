import { LoaderCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Brand } from '../../../components/Brand'
import { useAuth } from '../../auth/AuthContext'
import { confirmNavigation } from '../../../lib/navigationGuard'
import '../training.css'

/** `children`: Home's nav. Scenario pages leave it out, so nothing competes with the practice phone. */
export function TrainingHeader({ children }: { children?: ReactNode }) {
  const { logout, pending, error } = useAuth()
  const [failed, setFailed] = useState(false)
  const signingOut = pending === 'signout'

  // No navigation here: the route guard sends signed-out users to /login.
  async function signOut() {
    // Mid-call, ask first; leaving hangs up and reports the call before the session goes.
    if (!(await confirmNavigation())) return
    setFailed(!(await logout()))
  }

  return (
    <header className="train-header">
      <Brand to="/home" />
      {children}
      <div className="train-header-actions">
        {failed && error && <p className="train-header-error" role="alert">{error}</p>}
        <button type="button" className="train-ghost" onClick={() => void signOut()} disabled={Boolean(pending)} aria-busy={signingOut} title="Sign out">
          {signingOut && <LoaderCircle size={17} className="spinner" aria-hidden="true" />}
          <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </header>
  )
}
