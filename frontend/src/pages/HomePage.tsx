import { ArrowRight, Check, Info, RotateCcw, X } from 'lucide-react'
import { useEffect } from 'react'
import { CountUp } from '../components/CountUp'
import { RevealText } from '../components/RevealText'
import { TransitionLink } from '../components/TransitionLink'
import { useAuth } from '../features/auth/AuthContext'
import { InstinctsCard } from '../features/insights/InstinctsCard'
import { ScamProfileCard } from '../features/insights/ScamProfileCard'
import { NextForYou } from '../features/training/components/NextForYou'
import { PracticePath } from '../features/training/components/PracticePath'
import { TrainingHeader } from '../features/training/components/TrainingHeader'
import { currentLevel, recommend, timeline } from '../features/training/progress'
import { getScenario, isScam, scenarios } from '../features/training/scenarios'
import { useProgress } from '../features/training/useProgress'
import { useProfile } from '../features/profile/ProfileContext'

export function HomePage() {
  const { user, profileWarning, dismissProfileWarning } = useAuth()
  const { profile } = useProfile()
  const { progress, callSync, adaptive } = useProgress(user?.uid)
  const next = recommend(progress)
  const all = timeline(progress)
  const recent = all.slice(-8)
  const right = all.filter((attempt) => attempt.correct).length
  const firstName = (profile?.name || user?.displayName)?.trim().split(/\s+/)[0]
  const name = firstName ? `, ${firstName}` : ''

  const heading = all.length === 0 && !adaptive?.attempts.length ? `Welcome${name}. Let's find your blind spots.` : `Ready for your next scenario${name}?`
  const flagsSeen = [...new Set(scenarios
    .filter((scenario) => progress[scenario.id] && isScam(scenario))
    .flatMap((scenario) => scenario.indicators.map((indicator) => indicator.title)))]

  useEffect(() => { document.title = 'Home · Tellio' }, [])

  return (
    <div className="train-shell">
      <TrainingHeader />
      <main className="home-main">
        <div className="home-intro">
          <RevealText as="h1" text={heading} />
          <p className="home-lede">Tellio sends practice scam texts, emails and phone calls to a phone in your browser, and shapes each one around what caught you out before. You decide what you'd do, then see what gave it away. Nothing real is ever at risk.</p>

          {profileWarning && (
            <div className="train-notice" role="status">
              <Info size={18} aria-hidden="true" />
              <p>{profileWarning}</p>
              <button type="button" className="train-notice-dismiss" onClick={dismissProfileWarning} aria-label="Dismiss this message"><X size={18} aria-hidden="true" /></button>
            </div>
          )}

          <NextForYou adaptive={adaptive} localLevel={currentLevel(progress)} loading={callSync === 'loading'} />
          <ScamProfileCard uid={user?.uid} />
          <InstinctsCard uid={user?.uid} />

          <section className="home-progress" aria-labelledby="progress-title">
            <h2 id="progress-title">Your practice so far</h2>
            {all.length === 0
              ? <p>Nothing yet. After each scenario, you'll see here what you caught and which red flags you've learned to spot.</p>
              : (
                <>
                  <p>You've practised <strong><CountUp value={all.length} /></strong> {all.length === 1 ? 'time' : 'times'} and made the right call on <strong><CountUp value={right} /></strong>.</p>
                  <h3>Your last {recent.length === 1 ? 'attempt' : `${recent.length} attempts`}</h3>
                  <ol className="home-recent">
                    {recent.map((attempt) => (
                      <li key={`${attempt.id}-${attempt.at}`} className={attempt.correct ? 'is-right' : 'is-missed'}>
                        {attempt.correct ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <RotateCcw size={11} strokeWidth={3} aria-hidden="true" />}
                        <span className="sr-only">{getScenario(attempt.id)?.title ?? 'A scenario made for you'}: {attempt.correct ? 'right call' : 'missed'}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="home-recent-note">Right call on {recent.filter((attempt) => attempt.correct).length} of {recent.length}, oldest first.</p>
                  {flagsSeen.length > 0 && (
                    <>
                      <h3>Red flags you've met</h3>
                      <ul className="home-flags">{flagsSeen.map((flag) => <li key={flag}>{flag}</li>)}</ul>
                    </>
                  )}
                </>
              )}
            <p className="home-saved">{callSync === 'unavailable'
              ? "We couldn't reach your account just now, so this shows what's saved in this browser."
              : 'Your results are saved to your account.'}</p>
          </section>

          <section className="profile-summary" aria-label="Your saved profile">
            <div><strong>{profile?.name}</strong><span>{profile?.email} · {profile?.phone}</span></div>
            <TransitionLink className="text-link" to="/onboarding">Edit profile<ArrowRight size={14} aria-hidden="true" /></TransitionLink>
          </section>
        </div>

        <PracticePath progress={progress} upNextId={next?.id} />
      </main>
    </div>
  )
}
