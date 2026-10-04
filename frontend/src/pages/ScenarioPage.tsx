import { ArrowLeft, LoaderCircle, Mail, MessageSquareText, Phone } from 'lucide-react'
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { TransitionLink } from '../components/TransitionLink'
import { useAuth } from '../features/auth/AuthContext'
import { tracker } from '../features/insights/track'
import { messageOutcome, runEvent, type Run, type TrackedEvent, type TrackedType } from '../features/insights/tracker'
import { Debrief } from '../features/training/components/Debrief'
import { PhoneFrame } from '../features/training/components/PhoneFrame'
import { PhoneSimulator } from '../features/training/components/PhoneSimulator'
import { TrainingHeader } from '../features/training/components/TrainingHeader'
import { recommend } from '../features/training/progress'
import { hasLink, siteOf, type Action, type CallScenario, type MessageScenario, type Scenario } from '../features/training/scenarios'
import { useProgress } from '../features/training/useProgress'
import { useScenario } from '../features/training/useScenario'

const difficultyLabel = { easy: 'Gentle start', medium: 'A little trickier', hard: 'Tricky' }
const channelMeta = { sms: { Icon: MessageSquareText, label: 'Text message' }, email: { Icon: Mail, label: 'Email' }, call: { Icon: Phone, label: 'Phone call' } }

// The voice SDK (and LiveKit under it) is big: it loads only when a call scenario opens.
const CallExperience = lazy(() => import('../features/training/call/CallExperience'))

export function ScenarioPage() {
  const { scenarioId } = useParams()
  const state = useScenario(scenarioId)
  const scenario = state.status === 'ready' ? state.scenario : undefined

  return (
    <div className="train-shell">
      <TrainingHeader />
      {/* Keyed by id: a new scenario is a new run, and a call's voice provider lives exactly as long as its run. */}
      {state.status === 'loading' ? <ScenarioLoading /> : !scenario ? <MissingScenario /> : scenario.type === 'call' ? <CallRun key={scenario.id} scenario={scenario} /> : <ScenarioRun key={scenario.id} scenario={scenario} />}
    </div>
  )
}

function ScenarioIntro({ scenario }: { scenario: Scenario }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const { Icon, label } = channelMeta[scenario.type]

  useEffect(() => {
    document.title = `${scenario.title} · Tellio`
    // A new scenario is a new page: jump, don't glide, past the global smooth scroll.
    window.scrollTo({ top: 0, behavior: 'instant' })
    heading.current?.focus({ preventScroll: true })
  }, [scenario.title])

  return (
    <div className="scenario-intro">
      <TransitionLink direction="back" className="train-back" to="/home"><ArrowLeft size={16} aria-hidden="true" />All scenarios</TransitionLink>
      <h1 ref={heading} tabIndex={-1} style={{ viewTransitionName: `title-${scenario.id}` }}>{scenario.title}</h1>
      <p className="scenario-meta"><Icon size={15} aria-hidden="true" /> {label} <span aria-hidden="true">·</span> {difficultyLabel[scenario.difficulty]}</p>
      <p className="scenario-situation"><strong>What you know:</strong> {scenario.situation}</p>
    </div>
  )
}

function CallRun({ scenario }: { scenario: CallScenario }) {
  const { user } = useAuth()
  const { progress, record } = useProgress(user?.uid)
  return (
    <main className="scenario-main">
      <ScenarioIntro scenario={scenario} />
      <CallChunkBoundary>
        <Suspense fallback={<CallLoading />}>
          <CallExperience scenario={scenario} progress={progress} record={record} />
        </Suspense>
      </CallChunkBoundary>
    </main>
  )
}

function CallLoading({ failed = false }: { failed?: boolean }) {
  return (
    <section className="phone-wrap" aria-label="Practice phone">
      <PhoneFrame time="">
        {failed
          ? (
            <div className="call-loading" role="alert">
              <p>We couldn't load the call screen. Check your connection and try again.</p>
              <button type="button" className="train-ghost" onClick={() => window.location.reload()}>Reload</button>
            </div>
          )
          : <p className="call-loading" role="status"><LoaderCircle size={20} className="spinner" aria-hidden="true" /> Getting the phone ready…</p>}
      </PhoneFrame>
    </section>
  )
}

/** The call chunk can fail to download (offline, or a deploy replaced it): show a way out instead of a blank phone. */
class CallChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <CallLoading failed /> : this.props.children }
}

function ScenarioRun({ scenario }: { scenario: MessageScenario }) {
  const { user } = useAuth()
  const { progress, record } = useProgress(user?.uid)
  const [choice, setChoice] = useState<Action | null>(null)
  const [inspected, setInspected] = useState(false)
  const email = scenario.type === 'email'
  // One run, one attempt id: every behaviour event of this run is timed from when it opened (features/insights).
  const run = useRef<Run | null>(null)

  useEffect(() => {
    // Strict mode re-runs effects; the run (and its start event) happens once.
    if (!run.current) {
      run.current = { attemptId: crypto.randomUUID(), startedAt: performance.now() }
      tracker.track(runEvent(scenario, run.current, 'scenario_started'))
    }
    return () => { void tracker.flush() }
  }, [scenario])

  function track(type: TrackedType, extra?: Pick<TrackedEvent, 'outcome' | 'metadata'>) {
    if (run.current) tracker.track(runEvent(scenario, run.current, type, extra))
  }

  function choose(action: Action) {
    setChoice(action)
    record(scenario.id, action === scenario.correctAction)
    track(action === 'report' ? 'message_reported' : 'message_marked_safe')
    track('scenario_completed', { outcome: messageOutcome(action, scenario.correctAction) })
    // The debrief shows as soon as there is a choice.
    track('debrief_viewed')
    void tracker.flush()
  }

  function inspect(target: 'link' | 'sender', url?: string) {
    if (choice) return
    if (target === 'link') setInspected(true)
    track(target === 'link' ? 'link_clicked' : 'sender_inspected', url ? { metadata: { site: siteOf(url) } } : undefined)
  }

  return (
    <main className="scenario-main">
      <ScenarioIntro scenario={scenario} />

      <PhoneSimulator scenario={scenario} choice={choice} onChoose={choose} onInspect={inspect} />

      <div className="scenario-panel">
        {choice
          ? <Debrief scenario={scenario} choice={choice} inspected={inspected} next={recommend(progress, scenario.id)} />
          : (
            <div className="scenario-howto">
              <h2>Treat it like your own phone</h2>
              <ol>
                <li>Read the {email ? 'email' : 'message'} the way you would if it had just arrived.</li>
                {email && <li>Tap the sender's name to see the address it really came from.</li>}
                {hasLink(scenario) && <li>Tap the link to see where it goes. Practice links never open.</li>}
                <li>Then choose <strong>Looks safe</strong> or <strong>Report &amp; block</strong>.</li>
              </ol>
            </div>
          )}
      </div>
    </main>
  )
}

function ScenarioLoading() {
  return <main className="scenario-missing"><p className="call-loading" role="status"><LoaderCircle size={20} className="spinner" aria-hidden="true" /> Getting your scenario ready…</p></main>
}

function MissingScenario() {
  useEffect(() => { document.title = 'Scenario not found · Tellio' }, [])
  return (
    <main className="scenario-missing">
      <h1>We couldn't find that scenario.</h1>
      <p>It may have been renamed. Your practice path has everything that's available.</p>
      <TransitionLink direction="back" className="train-primary" to="/home">Back to home</TransitionLink>
    </main>
  )
}
