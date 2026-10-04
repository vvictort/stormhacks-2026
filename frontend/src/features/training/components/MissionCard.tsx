import { ArrowRight, Check, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mascot } from '../../../components/Mascot'
import { TransitionLink } from '../../../components/TransitionLink'
import { api } from '../../../lib/api'
import { withViewTransition } from '../../../lib/viewTransition'
import { levelName, nextForYou, type Adaptive } from '../adaptive'
import { updateAdventure, useAdventure } from '../adventureStore'
import { generateScenario } from '../generate'
import { badges, createMission, missionComplete, missionNext, missionUrl, prepareMission, type BadgeId, type Mission } from '../missions'
import type { Progress } from '../progress'
import { type Difficulty } from '../scenarios'
import './missions.css'

export function MissionProgress({ mission, currentId }: { mission?: Mission | null; currentId?: string }) {
  return (
    <div className="mission-progress">
      <ol aria-label="Mission progress">
        {[0, 1, 2].map(i => {
          const done = Boolean(mission?.completed.includes(mission.scenarioIds[i]))
          const current = mission ? mission.scenarioIds[i] === (currentId ?? missionNext(mission)) : i === 0
          return <li key={i} className={done ? 'is-done' : current ? 'is-current' : ''} aria-current={!done && current ? 'step' : undefined}>
            <span aria-hidden="true">{done ? <Check size={15} /> : i + 1}</span>
            <span className="sr-only">Scenario {i + 1}: {done ? 'completed' : current ? 'current' : 'upcoming'}</span>
          </li>
        })}
      </ol>
      <span>{mission?.completed.length ?? 0} of 3 completed</span>
    </div>
  )
}

export function BadgeCollection({ earned }: { earned: Partial<Record<BadgeId, number>> }) {
  return <section className="badge-collection" aria-labelledby="badges-title">
    <div className="home-section-head"><h2 id="badges-title">Your milestones</h2><span>{Object.keys(earned).length} of 3 earned</span></div>
    <ul>{badges.map((badge, index) => {
      return <li key={badge.id} className={earned[badge.id] !== undefined ? 'is-earned' : ''}>
        <span className="milestone-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div><strong>{badge.name}</strong><p>{badge.condition}</p></div>
        <span className="badge-status">{earned[badge.id] !== undefined ? 'Earned' : 'Not yet'}</span>
      </li>
    })}</ul>
  </section>
}

export function NewBadges({ ids }: { ids: BadgeId[] }) {
  if (!ids.length) return null
  return <div className="new-badges" role="status">
    {ids.map(id => <p key={id}><span><strong>{badges.find(b => b.id === id)!.name} earned!</strong> {badges.find(b => b.id === id)!.condition}</span></p>)}
  </div>
}

/** The selection is saved before generating. Failed/reloaded preparation can retry or keep its library email. */
export function MissionCard({ uid, progress, adaptive, difficulty, loading }: { uid: string | undefined; progress: Progress; adaptive: Adaptive | null; difficulty: Difficulty; loading: boolean }) {
  const state = useAdventure(uid)
  const navigate = useNavigate()
  const request = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string>()
  useEffect(() => () => request.current?.abort(), [])
  const mission = state.mission
  const complete = mission && missionComplete(mission)
  const next = nextForYou(adaptive, difficulty)

  function open(m: Mission) {
    withViewTransition('forward', () => navigate(missionUrl(m)))
  }
  async function start() {
    if (pending || !uid) return
    let selected = mission
    if (!selected || missionComplete(selected)) {
      selected = createMission(progress, next.difficulty, crypto.randomUUID())
      updateAdventure(uid, previous => ({ ...previous, mission: selected }))
    }
    if (selected.ready) return open(selected)
    const missionId = selected.id
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setFailure(undefined)
    try {
      const generated = await generateScenario((path, init) => api(path, { ...init, signal: controller.signal }, uid))
      if (controller.signal.aborted) return
      const prepared = updateAdventure(uid, previous => prepareMission(previous, missionId, generated))
      if (prepared.mission?.id === missionId && prepared.mission.ready && !missionComplete(prepared.mission)) open(prepared.mission)
    } catch (error) {
      if (!controller.signal.aborted) setFailure((error as Error).message)
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }
  function usePractice() {
    if (!mission || pending) return
    const prepared = updateAdventure(uid, previous => prepareMission(previous, mission.id))
    if (prepared.mission) open(prepared.mission)
  }

  return <>
    <section className={`mission-card${complete ? ' is-complete' : ''}`} aria-labelledby="mission-title">
      <div className="mission-card-heading">
        <div><p className="mission-eyebrow">Three messages. A few careful decisions.</p>
          <h2 id="mission-title">{complete ? 'Mission accomplished.' : mission?.completed.length ? 'Pick up where you left off.' : 'Your next mission'}</h2></div>
        <div className={`mission-mascot${complete ? ' is-celebrating' : ' is-waving'}`}><Mascot mood={complete ? 'happy' : 'curious'} /></div>
      </div>
      <p className="mission-objective">{complete ? 'You made time to practise. That’s how good habits stick.' : 'Read the message, check the details, then decide what you’d do.'}</p>
      <MissionProgress mission={mission} />
      <div className="mission-focus"><span>{loading ? 'Finding your next focus…' : next.title.replace(/, made for you$/, '')}</span><span>{levelName(next.difficulty)} practice</span></div>
      <div className="mission-start">
        <button type="button" className="train-primary" disabled={pending || !uid} aria-busy={pending} onClick={() => void start()}>
          {pending ? <><LoaderCircle size={17} className="spinner" aria-hidden="true" />Preparing your mission…</> : <>{failure ? 'Retry' : complete ? 'Start another mission' : mission ? 'Continue mission' : 'Start mission'}<ArrowRight size={17} aria-hidden="true" /></>}
        </button>
        <span>Texts &amp; emails</span>
      </div>
      <p className="mission-loading" role="status">{pending ? 'Writing a personal email. Your three selected scenarios are saved.' : ''}</p>
      {failure && <p className="mission-error" role="alert">{failure}</p>}
      {mission && !mission.ready && !pending && <button type="button" className="text-link mission-fallback" onClick={usePractice}>Use a practice scenario<ArrowRight size={15} aria-hidden="true" /></button>}
      <p className="mission-saved">{state.completedMissions > 0 && <>{state.completedMissions} mission{state.completedMissions === 1 ? '' : 's'} completed · </>}Missions &amp; badges are saved in this browser for your account.</p>
    </section>
    <BadgeCollection earned={state.earned} />
    {complete && <TransitionLink className="text-link mission-review" to="/home?tab=library&status=missed">Revisit something you missed<ArrowRight size={15} aria-hidden="true" /></TransitionLink>}
  </>
}
