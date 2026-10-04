import type { CSSProperties } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { Brand } from '../../../components/Brand'
import { Mascot } from '../../../components/Mascot'

export function AuthLayout() {
  return (
    <div className="auth-shell bg-background text-foreground">
      <a className="skip-link" href="#auth-content">Skip to form</a>
      <header className="site-header">
        <Brand to="/login" />
      </header>

      <main className="auth-main">
        <section className="editorial" aria-labelledby="editorial-title">
          <p id="editorial-title" className="editorial-title"><span className="reveal-line" style={{ '--w': 0 } as CSSProperties}>A little practice.</span><br /><span className="reveal-line" style={{ '--w': 3 } as CSSProperties}>A <em>sharper instinct.</em></span></p>
          <p className="editorial-description text-muted-strong">Tellio sends scam texts, emails and calls to a practice phone in your browser, so you learn the warning signs before a real one reaches you.</p>
          <Mascot className="auth-mascot" />
        </section>

        <div id="auth-content" className="auth-column" tabIndex={-1}>
          <p className="mobile-tagline text-muted-strong">Practice spotting scam texts, emails and calls, safely in your browser.</p>
          <Outlet />
          <p className="card-caption text-muted-strong"><ShieldCheck size={15} aria-hidden="true" /> Practice scams never reach your real phone or inbox.</p>
        </div>
      </main>

      <footer className="site-footer text-muted-strong">
        <p>© {new Date().getFullYear()} Tellio</p>
        <p>Built at StormHacks 2026</p>
      </footer>
    </div>
  )
}
