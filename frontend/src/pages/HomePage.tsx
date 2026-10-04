import { ArrowRight, Check, History, Info, Mail, MessageSquareText, Phone, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CountUp } from '../components/CountUp'
import { TransitionLink } from '../components/TransitionLink'
import { useAuth } from '../features/auth/AuthContext'
import { InstinctsCard } from '../features/insights/InstinctsCard'
import { ScamProfileCard } from '../features/insights/ScamProfileCard'
import { MadeForYouActions } from '../features/training/components/NextForYou'
import { MissionCard } from '../features/training/components/MissionCard'
import { PathStop, PracticePath } from '../features/training/components/PracticePath'
import { TrainingHeader } from '../features/training/components/TrainingHeader'
import { channelStats, currentLevel, recommend, summarize, timeline, type Progress } from '../features/training/progress'
import { getScenario, isScam, scenarios } from '../features/training/scenarios'
import { useProgress } from '../features/training/useProgress'
import { useProfile } from '../features/profile/ProfileContext'

const tabs = [{ id: 'practice', label: 'Practice' }, { id: 'library', label: 'Library' }, { id: 'insights', label: 'Insights' }] as const
type Tab = (typeof tabs)[number]['id']

export function HomePage() {
  const { user, profileWarning, dismissProfileWarning } = useAuth()
  const { profile } = useProfile()
  const { progress, callSync, adaptive } = useProgress(user?.uid)
  const [params, setParams] = useSearchParams()
  const tab: Tab = tabs.find((t) => t.id === (params.get('tab') === 'history' ? 'library' : params.get('tab')))?.id ?? 'practice'
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  const next = recommend(progress)
  const all = timeline(progress)
  const firstName = (profile?.name || user?.displayName)?.trim().split(/\s+/)[0]

  const greeting = all.length === 0 && !adaptive?.attempts.length ? 'Welcome' : 'Welcome back'
  const flagsSeen = [...new Set(scenarios
    .filter((scenario) => progress[scenario.id] && isScam(scenario))
    .flatMap((scenario) => scenario.indicators.map((indicator) => indicator.title)))]

  useEffect(() => { document.title = 'Home · Tellio' }, [])

  // Tabs live in the URL (Back and reload keep them); filters are dropped when you leave the Library.
  function show(id: Tab) {
    setParams(id === 'practice' ? {} : { tab: id }, { replace: true })
  }

  // WAI-ARIA tabs: arrow keys move between them, and the panel follows.
  function onTabKey(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const id = tabs[(tabs.findIndex((t) => t.id === tab) + step + tabs.length) % tabs.length].id
    show(id)
    tabRefs.current[id]?.focus()
  }

  return (
    <div className="train-shell">
      <TrainingHeader />
      <main className="home-main">
        <div className="home-welcome"><h1 className="home-title">{greeting}{firstName && <>, <span>{firstName}</span></>}.</h1><p>A little practice. A sharper instinct.</p></div>

        <div className="home-tabs segmented" role="tablist" aria-label="Home" onKeyDown={onTabKey}>
          {tabs.map((t) => (
            <button key={t.id} ref={(node) => { tabRefs.current[t.id] = node }} type="button" role="tab" id={`tab-${t.id}`}
              aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1} onClick={() => show(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="home-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} key={tab}>
          {tab === 'practice' && (
            <>
              {profileWarning && (
                <div className="train-notice" role="status">
                  <Info size={18} aria-hidden="true" />
                  <p>{profileWarning}</p>
                  <button type="button" className="train-notice-dismiss" onClick={dismissProfileWarning} aria-label="Dismiss this message"><X size={18} aria-hidden="true" /></button>
                </div>
              )}
              <MissionCard key={user?.uid} uid={user?.uid} progress={progress} adaptive={adaptive} difficulty={currentLevel(progress)} loading={callSync === 'loading'} />
              <section className="home-standalone" aria-labelledby="standalone-title">
                <h2 id="standalone-title">Just one scenario?</h2>
                <p>Pick a channel for a quick round of practice.</p>
                <MadeForYouActions key={user?.uid} difficulty={adaptive?.difficulty ?? currentLevel(progress)} label="Practise an email" variant="picker" progress={progress} />
              </section>
              {next && (
                <section className="home-upnext" aria-labelledby="upnext-title">
                  <div className="home-section-head">
                    <h2 id="upnext-title">From the library</h2>
                    <button type="button" className="text-link" onClick={() => show('library')}>Browse all<ArrowRight size={14} aria-hidden="true" /></button>
                  </div>
                  <ol className="path-stops"><PathStop scenario={next} progress={progress} upNext /></ol>
                </section>
              )}
            </>
          )}

          {tab === 'library' && <PracticePath progress={progress} />}

          {tab === 'insights' && (
            <>
              <ResultsSummary progress={progress} saved={callSync !== 'unavailable'} onMissed={() => setParams({ tab: 'library', status: 'missed' }, { replace: true })} />
              <InstinctsCard uid={user?.uid} />
              <ScamProfileCard uid={user?.uid} />
              {flagsSeen.length > 0 && (
                <section className="home-progress" aria-labelledby="flags-title">
                  <h2 id="flags-title">Red flags you've met</h2>
                  <ul className="home-flags">{flagsSeen.map((flag) => <li key={flag}>{flag}</li>)}</ul>
                </section>
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

/** Insights' numbers, all from this user's attempts: overall rate, coverage, what to revisit, per channel and lately. */
function ResultsSummary({ progress, saved, onMissed }: { progress: Progress; saved: boolean; onMissed: () => void }) {
  const all = timeline(progress)
  const right = all.filter((attempt) => attempt.correct).length
  const recent = all.slice(-8)
  const { total, done, correct } = summarize(progress)
  const missed = done - correct
  const channels = channelStats(progress)

  if (all.length === 0) return <section className="home-stats"><p>Nothing yet. Finish a scenario and your results show up here.</p></section>

  return (
    <section className="home-stats" aria-labelledby="results-title">
      <h2 id="results-title" className="sr-only">Your results</h2>
      <dl className="home-stat-grid">
        <div><dt>Right-call rate</dt><dd><CountUp value={percent(right, all.length)} />%</dd><dd className="home-stat-sub">{right} of {all.length} attempts</dd></div>
        <div><dt>Scenarios tried</dt><dd><CountUp value={done} /></dd><dd className="home-stat-sub">of {total} in the library</dd></div>
        <div className={missed ? 'is-missed' : undefined}>
          <dt>To revisit</dt><dd><CountUp value={missed} /></dd>
          <dd className="home-stat-sub">{missed ? <button type="button" className="text-link" onClick={onMissed}>Missed last time<ArrowRight size={13} aria-hidden="true" /></button> : 'Nothing missed'}</dd>
        </div>
      </dl>

      <div className="home-stat-head"><h3>By channel</h3><span>Right-call rate</span></div>
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
        <h3>Last {recent.length === 1 ? 'attempt' : `${recent.length} attempts`}</h3>
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
