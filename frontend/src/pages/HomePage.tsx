import { ArrowRight, Check, History, Info, Mail, MessageSquareText, Phone, RotateCcw, X } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CountUp } from '../components/CountUp'
import { RevealText } from '../components/RevealText'
import { TransitionLink } from '../components/TransitionLink'
import { useAuth } from '../features/auth/AuthContext'
import { InstinctsCard } from '../features/insights/InstinctsCard'
import { ScamProfileCard } from '../features/insights/ScamProfileCard'
import { NextForYou } from '../features/training/components/NextForYou'
import { PathStop, PracticePath } from '../features/training/components/PracticePath'
import { TrainingHeader } from '../features/training/components/TrainingHeader'
import { channelStats, currentLevel, recommend, summarize, timeline, type Progress } from '../features/training/progress'
import { getScenario, isScam, scenarios } from '../features/training/scenarios'
import { useProgress } from '../features/training/useProgress'
import { useProfile } from '../features/profile/ProfileContext'

// Practice is Home; the other two are optional side trips. Each lives in the URL, so Back and reload keep it.
const views = [
  { id: 'practice', label: 'Practice', to: '/home' },
  { id: 'history', label: 'Scenarios', to: '/home?tab=history', title: 'Scenarios' },
  { id: 'insights', label: 'Progress', to: '/home?tab=insights', title: 'Your progress' },
] as const

export function HomePage() {
  const { user, profileWarning, dismissProfileWarning } = useAuth()
  const { profile } = useProfile()
  const { progress, callSync, adaptive } = useProgress(user?.uid)
  const [params] = useSearchParams()
  const view = views.find((v) => v.id === params.get('tab')) ?? views[0]
  const next = recommend(progress)
  const all = timeline(progress)
  const right = all.filter((attempt) => attempt.correct).length
  const firstName = (profile?.name || user?.displayName)?.trim().split(/\s+/)[0]
  const name = firstName ? `, ${firstName}` : ''

  const heading = all.length === 0 && !adaptive?.attempts.length ? `Welcome${name}. Let's find your blind spots.` : `Ready when you are${name}.`
  // How it's going, in one sentence: the same numbers Progress leads with.
  const status = all.length > 1
    ? `You've made the right call on ${right} of ${all.length} so far.`
    : all.length === 1 && (right ? 'You made the right call on your first scenario.' : "Your first scenario caught you out. That's what practice is for.")
  const flagsSeen = [...new Set(scenarios
    .filter((scenario) => progress[scenario.id] && isScam(scenario))
    .flatMap((scenario) => scenario.indicators.map((indicator) => indicator.title)))]

  useEffect(() => { document.title = `${view.label} · Tellio` }, [view.label])

  return (
    <div className="train-shell">
      <TrainingHeader>
        {/* Plain Links: these switch Home's own views, and Home never hosts a call to guard. */}
        <nav className="home-nav" aria-label="Main">
          {views.map((v) => <Link key={v.id} to={v.to} aria-current={v.id === view.id ? 'page' : undefined}>{v.label}</Link>)}
        </nav>
      </TrainingHeader>
      <main className="home-main">
        {view.id === 'practice'
          ? <RevealText as="h1" className="home-title" text={heading} highlight={firstName} />
          : <h1 className="home-title">{view.title}</h1>}

        <div className="home-panel" key={view.id}>
          {view.id === 'practice' && (
            <>
              {status && <p className="home-status">{status}</p>}
              {profileWarning && (
                <div className="train-notice" role="status">
                  <Info size={18} aria-hidden="true" />
                  <p>{profileWarning}</p>
                  <button type="button" className="train-notice-dismiss" onClick={dismissProfileWarning} aria-label="Dismiss this message"><X size={18} aria-hidden="true" /></button>
                </div>
              )}
              <NextForYou adaptive={adaptive} localLevel={currentLevel(progress)} loading={callSync === 'loading'} />
              {next && (
                <section className="home-pick" aria-labelledby="pick-title">
                  <div className="home-section-head">
                    <h2 id="pick-title">Or pick one from the library</h2>
                    <Link className="text-link" to="/home?tab=history">All scenarios<ArrowRight size={14} aria-hidden="true" /></Link>
                  </div>
                  <ol className="path-stops"><PathStop scenario={next} progress={progress} /></ol>
                </section>
              )}
            </>
          )}

          {view.id === 'history' && <PracticePath progress={progress} />}

          {view.id === 'insights' && (
            <>
              <ResultsSummary progress={progress} saved={callSync !== 'unavailable'} />
              <InstinctsCard uid={user?.uid} />
              <ScamProfileCard uid={user?.uid} />
              {flagsSeen.length > 0 && (
                <details className="home-more">
                  <summary>Red flags you've met<span>{flagsSeen.length}</span></summary>
                  <ul className="home-flags">{flagsSeen.map((flag) => <li key={flag}>{flag}</li>)}</ul>
                </details>
              )}
              <section className="profile-summary" aria-label="Your saved profile">
                <div><strong>{profile?.name}</strong><span>{profile?.email} · {profile?.phone}</span></div>
                <TransitionLink className="text-link" to="/onboarding">Edit profile<ArrowRight size={14} aria-hidden="true" /></TransitionLink>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

const channelRows = [
  { key: 'sms', label: 'Texts', Icon: MessageSquareText },
  { key: 'email', label: 'Emails', Icon: Mail },
  { key: 'call', label: 'Calls', Icon: Phone },
  { key: 'other', label: 'Older scenarios', Icon: History },
] as const
const percent = (part: number, whole: number) => whole ? Math.round((part / whole) * 100) : 0

/** Progress' numbers, all from this user's attempts: one headline rate with its counts, then per channel and lately. */
function ResultsSummary({ progress, saved }: { progress: Progress; saved: boolean }) {
  const all = timeline(progress)
  const right = all.filter((attempt) => attempt.correct).length
  const recent = all.slice(-8)
  const { total, done, correct } = summarize(progress)
  const missed = done - correct
  const channels = channelStats(progress)

  if (all.length === 0) {
    return (
      <section className="home-stats" aria-label="Your results">
        <p>Nothing yet. Finish a scenario and your results show up here.</p>
        <Link className="text-link" to="/home">Start practising<ArrowRight size={14} aria-hidden="true" /></Link>
      </section>
    )
  }

  return (
    <section className="home-stats" aria-label="Your results">
      <p className="home-rate"><strong><CountUp value={percent(right, all.length)} />%</strong> right calls</p>
      <p className="home-rate-sub">
        <span>{right} of {all.length} attempts</span>
        <span>{done} of {total} scenarios tried</span>
        {missed ? <Link className="text-link" to="/home?tab=history&status=missed">{missed} to revisit<ArrowRight size={13} aria-hidden="true" /></Link> : <span>Nothing to revisit</span>}
      </p>

      <div className="home-stat-head"><h2>By channel</h2></div>
      <ul className="home-channels">
        {channelRows.filter((row) => row.key !== 'other' || channels.other.attempts).map(({ key, label, Icon }) => {
          const { attempts, right: ok } = channels[key]
          const rate = percent(ok, attempts)
          return (
            <li key={key}>
              <span className="home-channel-name"><Icon size={15} aria-hidden="true" />{label}</span>
              <span className="home-meter" aria-hidden="true"><span style={{ width: `${rate}%` }} /></span>
              <span className="home-channel-value">{attempts ? <><strong>{rate}%</strong> {ok} of {attempts}</> : 'Not tried yet'}</span>
            </li>
          )
        })}
      </ul>

      <div className="home-stat-head">
        <h2>Last {recent.length === 1 ? 'attempt' : `${recent.length} attempts`}</h2>
        <span>{recent.filter((attempt) => attempt.correct).length} right</span>
      </div>
      <ol className="home-recent" aria-label="Oldest first">
        {recent.map((attempt) => (
          <li key={`${attempt.id}-${attempt.at}`} className={attempt.correct ? 'is-right' : 'is-missed'}>
            {attempt.correct ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <RotateCcw size={11} strokeWidth={3} aria-hidden="true" />}
            <span className="sr-only">{getScenario(attempt.id)?.title ?? 'A scenario made for you'}: {attempt.correct ? 'right call' : 'missed'}</span>
          </li>
        ))}
      </ol>
      <p className="home-saved">Oldest to newest · {saved ? 'Saved to your account' : "Couldn't reach your account, so this is this browser's results"}</p>
    </section>
  )
}
