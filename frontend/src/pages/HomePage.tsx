import { ArrowRight, Check, History, Info, Mail, MessageSquareText, Phone, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CountUp } from '../components/CountUp'
import { RevealText } from '../components/RevealText'
import { TellIcon } from '../components/TellIcon'
import { TransitionLink } from '../components/TransitionLink'
import { useAuth } from '../features/auth/AuthContext'
import { InstinctsCard } from '../features/insights/InstinctsCard'
import { ScamProfileCard } from '../features/insights/ScamProfileCard'
import { ChannelSection } from '../features/training/components/ChannelSection'
import { MissionCard } from '../features/training/components/MissionCard'
import { PracticePath } from '../features/training/components/PracticePath'
import { TrainingHeader } from '../features/training/components/TrainingHeader'
import { nextForYou } from '../features/training/adaptive'
import { channelStats, currentLevel, summarize, timeline, type Progress } from '../features/training/progress'
import { getScenario, isScam, scenarios } from '../features/training/scenarios'
import { useProgress } from '../features/training/useProgress'
import { useProfile } from '../features/profile/ProfileContext'

const tabs = [
  { id: 'practice', label: 'Practice' },
  { id: 'history', label: 'History' },
  { id: 'insights', label: 'Insights' },
] as const
type Tab = (typeof tabs)[number]['id']

export function HomePage() {
  const { user, profileWarning, dismissProfileWarning } = useAuth()
  const { profile } = useProfile()
  const { progress, callSync, adaptive } = useProgress(user?.uid)
  const [params, setParams] = useSearchParams()
  const tab: Tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? 'practice'
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  const all = timeline(progress)
  const userLevel = currentLevel(progress)
  const adaptiveFocus = adaptive ? nextForYou(adaptive, userLevel) : null

  const firstName = (profile?.name || user?.displayName)?.trim().split(/\s+/)[0]
  const name = firstName ? `, ${firstName}` : ''

  const heading = all.length === 0 && !adaptive?.attempts.length ? `Welcome${name}. Let's find your blind spots.` : `Ready when you are${name}.`
  const flagsSeen = [...new Set(scenarios
    .filter((scenario) => progress[scenario.id] && isScam(scenario))
    .flatMap((scenario) => scenario.indicators.map((indicator) => indicator.title)))]

  const stats = channelStats(progress)

  useEffect(() => { document.title = 'Home · Tellio' }, [])

  // Tabs live in the URL (Back and reload keep them); filters are dropped when you leave History.
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
        <RevealText as="h1" className="home-title" text={heading} highlight={firstName} />

        <div className="home-tabs segmented" role="tablist" aria-label="Home sections" onKeyDown={onTabKey}>
          {tabs.map((t) => (
            <button
              key={t.id}
              ref={(node) => { tabRefs.current[t.id] = node }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => show(t.id)}
            >
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
                  <button type="button" className="train-notice-dismiss" onClick={dismissProfileWarning} aria-label="Dismiss this message">
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              )}

              {/* Gamification Mission Card */}
              <MissionCard key={user?.uid} uid={user?.uid} progress={progress} adaptive={adaptive} difficulty={currentLevel(progress)} loading={callSync === 'loading'} />

              {/* Quick jump navigation pills across all 3 channels */}
              <nav className="home-channel-jump" aria-label="Jump to channel section">
                <a href="#section-call" className="channel-jump-pill">
                  <Phone size={15} aria-hidden="true" />
                  <span>Calls</span>
                  <span className="jump-count">{stats.call.attempts ? `${stats.call.attempts} runs` : 'Ready'}</span>
                </a>
                <a href="#section-email" className="channel-jump-pill">
                  <Mail size={15} aria-hidden="true" />
                  <span>Emails</span>
                  <span className="jump-count">{stats.email.attempts ? `${stats.email.attempts} runs` : 'Ready'}</span>
                </a>
                <a href="#section-sms" className="channel-jump-pill">
                  <MessageSquareText size={15} aria-hidden="true" />
                  <span>Messaging</span>
                  <span className="jump-count">{stats.sms.attempts ? `${stats.sms.attempts} runs` : 'Ready'}</span>
                </a>
              </nav>

              {/* Adaptive recommendation banner if Tellio has user insights */}
              {adaptiveFocus && (
                <div className="home-adaptive-banner" role="region" aria-label="Adaptive focus recommendation">
                  <div className="home-adaptive-badge">
                    <TellIcon size={16} aria-hidden="true" />
                    <span>Tellio's Focus</span>
                  </div>
                  <div className="home-adaptive-content">
                    <p className="home-adaptive-title">{adaptiveFocus.title}</p>
                    <p className="home-adaptive-reason">
                      {adaptiveFocus.reason} · Difficulty: <strong>{adaptiveFocus.difficulty}</strong>
                    </p>
                  </div>
                </div>
              )}

              {/* Section 1: Calls */}
              <ChannelSection
                channel="call"
                title="Calls"
                subtitle="Interactive voice scam simulations powered by conversational AI. Practice recognizing caller urgency, authority impersonation, and phone fraud."
                badge="Live Voice AI"
                Icon={Phone}
                progress={progress}
                adaptiveDifficulty={userLevel}
              />

              {/* Section 2: Emails */}
              <ChannelSection
                channel="email"
                title="Emails"
                subtitle="Phishing inbox simulations. Inspect spoofed senders, deceptive domains, credential harvesting links, and suspicious attachments."
                badge="Phishing Inbox"
                Icon={Mail}
                progress={progress}
                adaptiveDifficulty={userLevel}
              />

              {/* Section 3: Messaging */}
              <ChannelSection
                channel="sms"
                title="Messaging"
                subtitle="Smishing text messages delivered to a simulated phone. Spot malicious links, fake delivery updates, and fraudulent 2FA security requests."
                badge="SMS & Smishing"
                Icon={MessageSquareText}
                progress={progress}
                adaptiveDifficulty={userLevel}
              />
            </>
          )}

          {tab === 'history' && <PracticePath progress={progress} />}

          {tab === 'insights' && (
            <>
              <ResultsSummary
                progress={progress}
                saved={callSync !== 'unavailable'}
                onMissed={() => setParams({ tab: 'history', status: 'missed' }, { replace: true })}
              />
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
