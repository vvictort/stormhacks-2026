import { ShieldCheck } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { Brand } from '../../../components/Brand'

export function AuthLayout() {
  return (
    <div className="auth-shell bg-background text-foreground">
      <a className="skip-link" href="#auth-content">Skip to form</a>
      <header className="auth-bar">
        <Brand to="/login" />
      </header>
      <main id="auth-content" className="auth-stage" tabIndex={-1}>
        <Outlet />
        <p className="auth-trust text-muted-strong"><ShieldCheck size={14} aria-hidden="true" />Practice scams never reach your real phone or inbox.</p>
      </main>
    </div>
  )
}
