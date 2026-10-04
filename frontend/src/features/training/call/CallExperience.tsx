import { ConversationProvider } from '@elevenlabs/react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSimulatedCall } from '../../../comms/useSimulatedCall'
import { api } from '../../../lib/api'
import { guardsNavigation, leaveDecision, setNavigationGuard, type LeaveTrigger } from '../../../lib/navigationGuard'
import { readCallResult, isScored, type CallResult } from '../callOutcome'
import { getAdventure, updateAdventure, useAdventure } from '../adventureStore'
import { badges, completeCallAdventure, missionComplete, missionUrl } from '../missions'
import { LearnedPanel } from '../components/NextForYou'
import { PhoneFrame } from '../components/PhoneFrame'
import { recommend, recordAttempt, type Progress } from '../progress'
import type { CallScenario } from '../scenarios'
import { useLearning } from '../useLearning'
import { CallDebrief } from './CallDebrief'
import { LiveCallScreen, PracticeCallScreen } from './CallPhone'
import { buildCallDebrief, callScreen, debriefSource, practiceResult } from './callModel'
import './call.css'

// The lazily loaded call boundary: @elevenlabs/react (and LiveKit under it) only ships in this chunk.
// ScenarioPage mounts it once per call run, keyed by scenario id, so the provider never remounts mid-call.

interface Props {
  uid: string | null | undefined
  scenario: CallScenario
  progress: Progress
  /** Saves a local (practice-mode) result. Live results are stored by the backend. */
  record: (id: string, correct: boolean) => void
}

export default function CallExperience(props: Props) {
  return <ConversationProvider><CallStage {...props} /></ConversationProvider>
}

const clockTime = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function CallStage({ uid, scenario, progress, record }: Props) {
  const call = useSimulatedCall()
  const adventure = useAdventure(uid)
  const [params] = useSearchParams()
  const missionId = params.get('mission')
  const mission = adventure.mission?.id === missionId ? adventure.mission : null
  const [earnedBefore] = useState(() => getAdventure(uid).earned)
  const [practiceAttemptId] = useState(() => `practice-call:${crypto.randomUUID()}`)
  const previouslyMissed = useRef(false)
  const submittedPractice = useRef(false)
  const [practice, setPractice] = useState<{ result: CallResult | null } | null>(null)
  const [asking, setAsking] = useState<{ trigger: LeaveTrigger; resolve: (leave: boolean) => void } | null>(null)
  const [time] = useState(clockTime)
  const completed = call.phase === 'completed'
  const result = completed ? readCallResult(call.record) : null
  const screen = callScreen({ phase: call.phase, callId: call.callId, error: call.error, result })
  const callerLabel = call.callerLabel ?? scenario.callerLabel
  const guarded = !practice && guardsNavigation(call.phase)

  // While a live call is connecting or on: links and sign-out ask first, reload/close gets the browser's prompt,
  // and Back lands on a duplicate entry of this page so we can ask before really leaving.
  useEffect(() => {
    if (!guarded) return
    const unregister = setNavigationGuard(() => new Promise((resolve) => setAsking({ trigger: 'link', resolve })))
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const onPop = () => setAsking({ trigger: 'back_button', resolve: () => {} })
    window.history.pushState({ ...window.history.state, tellioCallGuard: true }, '', window.location.href)
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('popstate', onPop)
    return () => {
      unregister()
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('popstate', onPop)
      // Call over and still on this page: drop the duplicate entry so Back isn't a dead press.
      if (window.history.state?.tellioCallGuard) window.history.back()
    }
  }, [guarded])

  async function chooseLeave(choice: 'stay' | 'leave') {
    if (!asking) return
    const decision = leaveDecision(call.phase, asking.trigger, choice)
    setAsking(null)
    if (decision === 'stay') return asking.resolve(false)
    if (decision === 'restore_entry') return window.history.pushState({ ...window.history.state, tellioCallGuard: true }, '', window.location.href)
    if (decision === 'hang_up_then_back' || decision === 'hang_up_then_go') await call.leave()
    if (asking.trigger === 'back_button') window.history.back()
    else asking.resolve(true)
  }

  // Debrief data: the stored backend attempt if it's there yet, otherwise the comms record (always available).
  const [attempt, setAttempt] = useState<{ callId: string; data: unknown } | null>(null)
  useEffect(() => {
    if (!completed || !call.callId) return
    const callId = call.callId
    const controller = new AbortController()
    api<unknown>(`/training/attempts/${encodeURIComponent(callId)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) }, uid ?? undefined)
      .then((data) => { if (!controller.signal.aborted) setAttempt({ callId, data }) })
      .catch(() => { if (!controller.signal.aborted) setAttempt({ callId, data: null }) })
    return () => controller.abort()
  }, [completed, call.callId, uid])
  const attemptReady = attempt !== null && attempt.callId === call.callId

  function finishPractice(action: 'hang_up' | 'comply') {
    if (submittedPractice.current) return
    submittedPractice.current = true
    const outcome = practiceResult(action)
    setPractice({ result: outcome })
    if (isScored(outcome)) record(scenario.id, outcome.success)
  }

  function startPractice() {
    previouslyMissed.current = progress[scenario.id]?.correct === false
    submittedPractice.current = false
    call.reset()
    setPractice({ result: null })
  }
  function startLive() {
    previouslyMissed.current = progress[scenario.id]?.correct === false
    void call.start(scenario.id)
  }

  const debrief = practice?.result
    ? buildCallDebrief(scenario, { result: practice.result, from: 'practice' })
    : completed && attemptReady ? buildCallDebrief(scenario, debriefSource(attempt.data, call.record)) : null
  const liveResult = !practice && completed ? debriefSource(attemptReady ? attempt.data : null, call.record).result : null
  // Award only after the same authoritative result used by the debrief is ready.
  const finishedResult = practice?.result ?? (attemptReady ? liveResult : null)
  const finishedId = practice ? practiceAttemptId : call.callId
  const finishedOutcome = finishedResult?.outcome
  const finishedSuccess = finishedResult?.success
  useEffect(() => {
    if (!finishedId || !finishedOutcome || finishedSuccess === undefined) return
    updateAdventure(uid, state => completeCallAdventure(state, {
      attemptId: finishedId, scenarioId: scenario.id, result: { outcome: finishedOutcome, success: finishedSuccess },
      previouslyMissed: previouslyMissed.current, missionId, at: Date.now(),
    }))
  }, [uid, finishedId, finishedOutcome, finishedSuccess, scenario.id, missionId])
  const earnedNow = badges.filter(badge => earnedBefore[badge.id] === undefined && adventure.earned[badge.id] !== undefined).map(badge => badge.id)
  // A live result may not be on the server yet; count it for the recommendation so "Next" moves on.
  const next = recommend(isScored(liveResult) ? recordAttempt(progress, scenario.id, liveResult.success) : progress, scenario.id)
  // Scored live calls are saved server-side once analysed; the debrief then shows what changed (practice stays local).
  const savedId = !practice && isScored(liveResult) ? call.callId : null
  const learning = useLearning(uid, savedId)

  return (
    <>
      <section className="phone-wrap" aria-label="Practice phone">
        <PhoneFrame time={time}>
          {practice
            ? <PracticeCallScreen scenario={scenario} done={practice.result !== null} onDone={finishPractice} />
            : (
              <LiveCallScreen scenario={scenario} screen={screen} callerLabel={callerLabel} captions={call.captions}
                agentSpeaking={call.agentSpeaking} durationSecs={call.record?.durationSecs}
                onStart={startLive} onAccept={() => void call.accept()} onDecline={() => void call.decline()}
                onHangUp={call.hangUp} onCancel={call.cancel} onRetry={() => call.phase === 'ringing' ? void call.accept() : startLive()}
                onPractice={startPractice} />
            )}
        </PhoneFrame>
      </section>

      <div className="scenario-panel">
        {debrief
          ? <CallDebrief key={practice ? 'practice' : call.callId} view={debrief} next={next} callerLabel={practice ? scenario.callerLabel : callerLabel}
            mission={mission} missionHref={mission && !missionComplete(mission) && isScored(finishedResult) ? missionUrl(mission) : undefined} earnedNow={earnedNow}
            retry={mission && !isScored(finishedResult) ? { live: call.reset, captions: startPractice } : undefined}
            learned={savedId && learning.status !== 'off' && learning.status !== 'loading' ? <LearnedPanel learning={learning} attemptId={savedId} withActions={!mission} /> : undefined} />
          : <CallHowTo practice={Boolean(practice)} />}
      </div>

      <LeaveDialog open={asking !== null} onChoose={(choice) => void chooseLeave(choice)} />
    </>
  )
}

function CallHowTo({ practice }: { practice: boolean }) {
  return (
    <ul className="scenario-howto" aria-label="Tips">
      {practice
        ? <><li>Read the caller's words in the captions.</li><li>Hang up whenever you need to.</li></>
        : <><li>Answer or decline, just as you would on your phone.</li><li>Talk to the practice caller. Captions appear as you go.</li></>}
      <li>This is a simulation. Nothing real is at risk.</li>
    </ul>
  )
}

function LeaveDialog({ open, onChoose }: { open: boolean; onChoose: (choice: 'stay' | 'leave') => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog ref={dialog} className="reset-dialog call-leave border-border bg-surface" aria-labelledby="leave-title" aria-describedby="leave-text"
      onCancel={(event) => { event.preventDefault(); onChoose('stay') }}>
      <h2 id="leave-title">Leave this call?</h2>
      <p id="leave-text">Leaving hangs up the practice call. What was said so far is still checked, and the result goes to your progress.</p>
      <div className="call-leave-actions">
        <button type="button" className="train-primary" autoFocus onClick={() => onChoose('stay')}>Stay on the call</button>
        <button type="button" className="train-ghost" onClick={() => onChoose('leave')}>Hang up and leave</button>
      </div>
    </dialog>
  )
}
