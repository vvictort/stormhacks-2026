import { ShieldCheck } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { Brand } from '../../../components/Brand'
import { SecurityIllustration } from './SecurityIllustration'

export function AuthLayout() {
  return (
    <div className="auth-shell bg-background text-foreground">
      <a className="skip-link" href="#auth-content">Skip to form</a>
      <header className="site-header">
        <Brand to="/login" />
      </header>

      <main className="auth-main">
        <section className="editorial" aria-labelledby="editorial-title">
          <p id="editorial-title" className="editorial-title">A little practice.<br />A <em>sharper instinct.</em></p>
          <p className="editorial-description text-muted-strong">Tellio sends scam texts, emails and calls to a practice phone in your browser, so you learn the warning signs before a real one reaches you.</p>
          <SecurityIllustration />
          <ol className="how-it-works">
            <li><strong>A message arrives.</strong> <span className="text-muted-strong">A text, email or call, written like a real scam.</span></li>
            <li><strong>You respond.</strong> <span className="text-muted-strong">Reply, tap the link, ignore it or hang up. Nothing real happens.</span></li>
            <li><strong>See the red flags.</strong> <span className="text-muted-strong">Then on to the next one, matched to how you did.</span></li>
          </ol>
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
