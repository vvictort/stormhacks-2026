import { ArrowUpRight, ShieldCheck } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'
import { SecurityIllustration } from './SecurityIllustration'

export function AuthLayout() {
  return (
    <div className="auth-shell bg-background text-foreground">
      <a className="skip-link" href="#auth-content">Skip to form</a>
      <header className="site-header">
        <Link to="/login" className="brand" aria-label="Tellio home">
          <span className="brand-mark bg-primary" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M10 7v13c0 4 3 6 7 5l4-1M5 12h21M18 7v10" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
              <path d="m22 5 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" fill="currentColor" />
            </svg>
          </span>
          <span>tellio<span className="text-primary">.</span></span>
        </Link>
        <p className="header-note text-muted-strong">A little wiser. A lot more confident.</p>
        <span className="header-label"><span className="bg-success" /> SCAM AWARENESS, MADE HUMAN</span>
      </header>

      <main className="auth-main">
        <section className="editorial" aria-labelledby="editorial-title">
          <p className="eyebrow"><span className="editorial-line bg-primary" /> YOUR INSTINCT IS WORTH TRAINING</p>
          <h2 id="editorial-title">A little practice.<br />A <em>sharper instinct.</em></h2>
          <p className="editorial-description text-muted-strong">The online world can be tricky. Learn to spot the signs, trust your judgment, and take your next step with confidence.</p>
          <SecurityIllustration />
          <div className="editorial-footnote">
            <span className="footnote-number text-primary-strong">01 —</span>
            <div>
              <p>Build your instinct. Spot the scam.</p>
              <p className="text-muted-strong">Real-world practice. A safe place to learn.</p>
            </div>
            <ArrowUpRight size={19} className="text-muted-strong" aria-hidden="true" />
          </div>
        </section>

        <div id="auth-content" className="auth-column" tabIndex={-1}>
          <p className="mobile-tagline text-muted-strong">Build your instinct. Spot the scam.</p>
          <Outlet />
          <p className="card-caption text-muted-strong"><ShieldCheck size={15} aria-hidden="true" /> A small step toward a safer digital life.</p>
        </div>
      </main>

      <footer className="site-footer text-muted-strong">
        <p>© {new Date().getFullYear()} Tellio</p>
        <p>More awareness. Less second-guessing.<span className="footer-spark text-primary" aria-hidden="true">✳</span></p>
      </footer>
    </div>
  )
}
