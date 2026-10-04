import { LoaderCircle, LogOut } from 'lucide-react'
import { useState } from 'react'
import { Brand } from '../../../components/Brand'
import { useAuth } from '../../auth/AuthContext'
import '../training.css'

export function TrainingHeader() {
  const { logout, pending, error } = useAuth()
  const [failed, setFailed] = useState(false)
  const signingOut = pending === 'signout'

  // No navigation here: the route guard sends signed-out users to /login.
  async function signOut() {
    setFailed(!(await logout()))
  }

  return (
    <header className="train-header">
      <Brand to="/home" />
      <div className="train-header-actions">
        {failed && error && <p className="train-header-error" role="alert">{error}</p>}
        <button type="button" className="train-ghost" onClick={() => void signOut()} disabled={Boolean(pending)} aria-busy={signingOut}>
          {signingOut ? <LoaderCircle size={17} className="spinner" aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  )
}
