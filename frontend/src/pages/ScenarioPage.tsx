import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { TransitionLink } from '../components/TransitionLink'
import { useAuth } from '../features/auth/AuthContext'
import { tracker } from '../features/insights/track'
import { messageOutcome, runEvent, type Run, type TrackedEvent, type TrackedType } from '../features/insights/tracker'
import { generatedCredit } from '../features/training/attribution'
import { Debrief } from '../features/training/components/Debrief'
import { LearnedPanel } from '../features/training/components/NextForYou'
import { PhoneFrame } from '../features/training/components/PhoneFrame'
import { PhoneSimulator } from '../features/training/components/PhoneSimulator'
import { MissionProgress } from '../features/training/components/MissionCard'
import { updateAdventure, useAdventure } from '../features/training/adventureStore'
import { badges, completeAdventure, missionComplete, missionUrl, type BadgeId } from '../features/training/missions'
import { TrainingHeader } from '../features/training/components/TrainingHeader'
import { recommend } from '../features/training/progress'
import { scoreFlags, type Confidence, type FlagScore } from '../features/training/flagging'
import { hasLink, isScam, siteOf, type Action, type CallScenario, type MessageScenario, type Scenario } from '../features/training/scenarios'
import { useProgress } from '../features/training/useProgress'
import { useLearning } from '../features/training/useLearning'
import { useScenario } from '../features/training/useScenario'

const difficultyLabel = { easy: 'Gentle start', medium: 'A little trickier', hard: 'Tricky' }
const channelLabel = { sms: 'Text message', email: 'Email', call: 'Phone call' }

// The voice SDK (and LiveKit under it) is big: it loads only when a call scenario opens.
const CallExperience = lazy(() => import('../features/training/call/CallExperience'))

export function ScenarioPage() {
  const { user } = useAuth()
  const { scenarioId } = useParams()
  const state = useScenario(scenarioId)
  const scenario = state.status === 'ready' ? state.scenario : undefined

  return (
    <div className="train-shell">
      <TrainingHeader />
      {/* Keyed by id: a new scenario is a new run, and a call's voice provider lives exactly as long as its run. */}
      {state.status === 'loading' ? <ScenarioLoading /> : !scenario ? <MissingScenario /> : scenario.type === 'call' ? <CallRun key={`${user?.uid}:${scenario.id}`} scenario={scenario} /> : <ScenarioRun key={`${user?.uid}:${scenario.id}`} scenario={scenario} />}
    </div>
  )
}

/** `sourceShown`: the source line says what a text or email was built from (real scams or real genuine emails), which gives the answer away; it waits for the choice. */
function ScenarioIntro({ scenario, embedded = false, sourceShown = true }: { scenario: Scenario; embedded?: boolean; sourceShown?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const label = channelLabel[scenario.type]
  const credit = generatedCredit(scenario.generated, !isScam(scenario))

  useEffect(() => {
    document.title = `${scenario.title} · Tellio`
    // A new scenario is a new page: jump, don't glide, past the global smooth scroll.
    window.scrollTo({ top: 0, behavior: 'instant' })
    heading.current?.focus({ preventScroll: true })
  }, [scenario.title])

  return (
    <div className={embedded ? undefined : "scenario-intro"}>
      <TransitionLink direction="back" className="train-back" to="/home" aria-label="Back to all scenarios"><ArrowLeft size={16} aria-hidden="true" />Back</TransitionLink>
      <h1 ref={heading} tabIndex={-1} style={{ viewTransitionName: `title-${scenario.id}` }}>{scenario.title}</h1>
      <p className="scenario-meta">{label} <span aria-hidden="true">·</span> {difficultyLabel[scenario.difficulty]}</p>
      {scenario.generated && sourceShown && (
        <div className="scenario-generated">
          {/* The reason can carry a dataset licence credit, so it stays one tap away. Practice-path scenarios (lib-…) weren't made for this user. */}
          <details><summary>{scenario.id.startsWith('gen-') ? 'Made for you' : 'Source'}</summary><p>{scenario.generated.reason}</p></details>
          {/* Honest source line: only when Gemini really wrote it (the fallback is a built-in template). */}
          {credit && <span className="scenario-source">{credit}</span>}
        </div>
      )}
      <p className="scenario-situation">{scenario.situation}</p>
    </div>
  )
}

function CallRun({ scenario }: { scenario: CallScenario }) {
  const { user } = useAuth()
  const { progress, record } = useProgress(user?.uid)
  const adventure = useAdventure(user?.uid)
  const [params] = useSearchParams()
  const mission = adventure.mission?.id === params.get('mission') ? adventure.mission : null
  return (
    <main className="scenario-main">
      <div className="scenario-intro"><ScenarioIntro scenario={scenario} embedded />
        {mission && <div className="mission-run"><p>{missionComplete(mission) ? 'Mission complete. Every decision counts.' : 'Your three-scenario mission'}</p><MissionProgress mission={mission} currentId={scenario.id} /></div>}
      </div>
      <CallChunkBoundary>
        <Suspense fallback={<CallLoading />}>
          <CallExperience uid={user?.uid} scenario={scenario} progress={progress} record={record} />
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
  const adventure = useAdventure(user?.uid)
  const [params] = useSearchParams()
  const mission = adventure.mission?.id === params.get('mission') ? adventure.mission : null
  const submitted = useRef(false)
  const [earnedNow, setEarnedNow] = useState<BadgeId[]>([])
  const [choice, setChoice] = useState<Action | null>(null)
  const [confidence, setConfidence] = useState<Confidence | null>(null)
  const [flagScore, setFlagScore] = useState<FlagScore | null>(null)
  const [flaggedPhrases, setFlaggedPhrases] = useState<string[]>([])
  const [inspectedLink, setInspectedLink] = useState(false)
  const [inspectedSender, setInspectedSender] = useState(false)
  const email = scenario.type === 'email'
  // One run, one attempt id: every behaviour event of this run is timed from when it opened (features/insights).
  const run = useRef<Run | null>(null)
  // Set once this run's result has been sent: the debrief then compares Tellio's picture of the user before and after.
  const [finished, setFinished] = useState<{ attemptId: string; sent: boolean } | null>(null)
  const learning = useLearning(user?.uid, finished?.sent ? finished.attemptId : null)

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

  function toggleFlag(phrase: string) {
    if (choice) return
    setFlaggedPhrases((prev) =>
      prev.includes(phrase) ? prev.filter((p) => p !== phrase) : [...prev, phrase]
    )
  }

  function choose(action: Action, conf: Confidence) {
    if (submitted.current || !run.current) return
    submitted.current = true
    const correct = action === scenario.correctAction
    const before = adventure.earned
    const after = updateAdventure(user?.uid, state => completeAdventure(state, {
      attemptId: run.current!.attemptId, scenarioId: scenario.id, correct, scam: scenario.correctAction === 'report',
      previouslyMissed: progress[scenario.id]?.correct === false, missionId: params.get('mission'), at: Date.now(),
    }))
    setEarnedNow(badges.filter(b => before[b.id] === undefined && after.earned[b.id] !== undefined).map(b => b.id))
    setChoice(action)
    setConfidence(conf)
    const score = scoreFlags(flaggedPhrases, scenario.indicators)
    setFlagScore(score)
    record(scenario.id, action === scenario.correctAction)
    track(action === 'report' ? 'message_reported' : 'message_marked_safe')
    track('scenario_completed', {
      outcome: messageOutcome(action, scenario.correctAction),
      metadata: {
        confidence: conf,
        flagsCaught: score.caught,
        flagsMissed: score.missed,
        flagsWrong: score.wrong,
        flaggedCount: flaggedPhrases.length,
      },
    })
    // The debrief shows as soon as there is a choice.
    track('debrief_viewed')
    const attemptId = run.current?.attemptId
    if (!attemptId) return void tracker.flush()
    setFinished({ attemptId, sent: false })
    void tracker.flush().then(() => setFinished({ attemptId, sent: true }))
  }

  function inspect(target: 'link' | 'sender', url?: string) {
    if (choice) return
    if (target === 'link') setInspectedLink(true)
    if (target === 'sender') setInspectedSender(true)
    track(target === 'link' ? 'link_clicked' : 'sender_inspected', url ? { metadata: { site: siteOf(url) } } : undefined)
  }

  return (
    <main className="scenario-main">
      <div className="scenario-intro">
        <ScenarioIntro scenario={scenario} embedded sourceShown={Boolean(choice)} />
        {mission && <div className="mission-run"><p>{missionComplete(mission) ? 'Mission complete. Every decision counts.' : 'Your three-scenario mission'}</p><MissionProgress mission={mission} currentId={scenario.id} /></div>}
        {!choice && !adventure.tipSeen && <aside className="practice-tip" aria-label="How to practise"><p><strong>A quick tip</strong>Tap suspicious phrases, inspect the sender or link, then decide. Your selections are checked after you answer.</p><button type="button" className="text-link" onClick={() => updateAdventure(user?.uid, state => ({ ...state, tipSeen: true }))}>Got it</button></aside>}
      </div>

      <PhoneSimulator
        scenario={scenario}
        choice={choice}
        confidence={confidence}
        flaggedPhrases={flaggedPhrases}
        onToggleFlag={toggleFlag}
        onChoose={choose}
        onInspect={inspect}
      />

      <div className="scenario-panel">
        {choice
          ? <Debrief
              scenario={scenario}
              choice={choice}
              confidence={confidence}
              flagScore={flagScore}
              inspectedLink={inspectedLink}
              inspectedSender={inspectedSender}
              flaggedCount={flaggedPhrases.length}
              mission={mission}
              missionHref={mission && !missionComplete(mission) ? missionUrl(mission) : undefined}
              earnedNow={earnedNow}
              next={recommend(progress, scenario.id)}
              learned={finished && learning.status !== 'off' && learning.status !== 'loading' ? <LearnedPanel learning={learning} attemptId={finished.attemptId} withActions={!mission} /> : undefined}
            />
          : (
            <ul className="scenario-howto" aria-label="Tips">
              <li>Read it like it's real.</li>
              {email && <li>Tap the sender to see the address.</li>}
              {hasLink(scenario) && <li>Tap a link to preview its destination.</li>}
            </ul>
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
      <p>It may have been renamed. The Library on Home lists the practice scenarios.</p>
      <TransitionLink direction="back" className="train-primary" to="/home">Back to home</TransitionLink>
    </main>
  )
}
