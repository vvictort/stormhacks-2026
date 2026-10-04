import { ArrowRight, Info } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext'
import { PracticePath } from '../features/training/components/PracticePath'
import { TrainingHeader } from '../features/training/components/TrainingHeader'
import { recommend, summarize } from '../features/training/progress'
import { scenarios } from '../features/training/scenarios'
import { useProgress } from '../features/training/useProgress'

export function HomePage() {
  const { user, profileWarning } = useAuth()
  const { progress } = useProgress(user?.uid)
  const { done, total, correct } = summarize(progress)
  const next = recommend(progress)
  const target = next ?? scenarios[0]
  const firstName = user?.displayName?.trim().split(/\s+/)[0]
  const name = firstName ? `, ${firstName}` : ''

  const heading = done === 0
    ? `Welcome${name}. Let's start with a text.`
    : next ? `Ready for another scenario${name}?` : `You've tried every text scenario${name}.`
  const cta = done === 0 ? 'Start your first scenario' : !next ? 'Practise again' : progress[next.id] ? 'Try it again' : 'Start next scenario'
  const flagsSeen = [...new Set(scenarios
    .filter((scenario) => progress[scenario.id] && scenario.correctAction === 'report')
    .flatMap((scenario) => scenario.indicators.map((indicator) => indicator.title)))]

  useEffect(() => { document.title = 'Home · Tellio' }, [])

  return (
    <div className="train-shell">
      <TrainingHeader />
      <main className="home-main">
        <div className="home-intro">
          <h1>{heading}</h1>
          <p className="home-lede">Tellio sends practice scam texts to a phone in your browser. You decide what you'd do, then see what gave it away. Nothing real is ever at risk.</p>

          {profileWarning && (
            <div className="train-notice" role="status">
              <Info size={18} aria-hidden="true" />
              <p>{profileWarning}</p>
              {/* Integration: a dismiss button calling dismissProfileWarning() goes here. */}
            </div>
          )}

          <div className="home-cta">
            <Link className="train-primary" to={`/train/${target.id}`}>{cta}<ArrowRight size={17} aria-hidden="true" /></Link>
            <p>{next ? 'Up next' : 'Starts with'}: <strong>{target.title}</strong></p>
          </div>

          <section className="home-progress" aria-labelledby="progress-title">
            <h2 id="progress-title">Your practice so far</h2>
            {done === 0
              ? <p>Nothing yet. After each scenario, you'll see here what you caught and which red flags you've learned to spot.</p>
              : (
                <>
                  <p>You've tried <strong>{done} of {total}</strong> text scenarios and made the right call on <strong>{correct}</strong>.</p>
                  {flagsSeen.length > 0 && (
                    <>
                      <h3>Red flags you've met</h3>
                      <ul className="home-flags">{flagsSeen.map((flag) => <li key={flag}>{flag}</li>)}</ul>
                    </>
                  )}
                </>
              )}
            <p className="home-saved">Saved in this browser for now.</p>
          </section>
        </div>

        <PracticePath progress={progress} upNextId={next?.id} />
      </main>
    </div>
  )
}
