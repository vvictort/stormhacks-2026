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
import { getScenario, type Difficulty } from '../scenarios'
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
    <div className="home-section-head"><h2 id="badges-title">Your achievements</h2><span>{Object.keys(earned).length} of 3 earned</span></div>
    <ul>{badges.map(badge => {
      const unlocked = earned[badge.id] !== undefined
      return <li key={badge.id} className={`achievement-card achievement-${badge.id}${unlocked ? ' is-earned' : ''}`}>
        <BadgeEmblem id={badge.id} />
        <div className="achievement-copy"><strong>{badge.name}</strong><p>{badge.condition}</p></div>
        <span className="badge-status">{unlocked ? <><Check size={13} aria-hidden="true" />Earned</> : 'Locked'}</span>
      </li>
    })}</ul>
  </section>
}

/** Small collectible seals: each achievement has its own mark, with shared ribbon details. */
function BadgeEmblem({ id }: { id: BadgeId }) {
  const edge = Array.from({ length: 48 }, (_, i) => {
    const angle = i * Math.PI / 24 - Math.PI / 2
    const radius = i % 2 ? 30 : 32
    return `${40 + Math.cos(angle) * radius},${38 + Math.sin(angle) * radius}`
  }).join(' ')
  return <svg className="achievement-emblem" viewBox="0 0 80 92" aria-hidden="true" focusable="false">
    <path className="achievement-ribbon" d="M23 53 18 85 30 78 40 86 42 55M38 55 40 86 50 78 62 85 57 53" />
    <polygon className="achievement-seal" points={edge} />
    <circle className="achievement-ring" cx="40" cy="38" r="24" />
    <g className="achievement-mark" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {id === 'first-steps' ? <><path d="M33 51V25m0 1c9-6 13 6 22 0v15c-9 6-13-6-22 0" /><path d="M27 52h13" /></>
        : id === 'good-catch' ? <><circle cx="37" cy="35" r="10" /><path d="m44 43 9 10m-20-18 3 3 5-6" /></>
        : <><path d="M54 35a14 14 0 1 0-4 14M54 25v10H44" /><path d="m35 39 4 4 7-8" /></>}
    </g>
  </svg>
}

export function NewBadges({ ids }: { ids: BadgeId[] }) {
  if (!ids.length) return null
  return <div className="new-badges" role="status">
    {ids.map(id => <p key={id} className={`achievement-${id} is-earned`}><BadgeEmblem id={id} /><span><strong>{badges.find(b => b.id === id)!.name} earned!</strong> {badges.find(b => b.id === id)!.condition}</span></p>)}
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
  const includesCalls = !mission || mission.scenarioIds.some(id => getScenario(id)?.type === 'call')

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
    // A mission with a genuine library email is already complete as a selection; keep that genuine message.
    const hasScamEmail = selected.scenarioIds.some(id => {
      const scenario = getScenario(id)
      return scenario?.type === 'email' && scenario.correctAction === 'report'
    })
    if (!hasScamEmail) {
      const prepared = updateAdventure(uid, previous => prepareMission(previous, missionId))
      if (prepared.mission?.id === missionId) open(prepared.mission)
      return
    }
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
        <div><p className="mission-eyebrow">Three scenarios. A few careful decisions.</p>
          <h2 id="mission-title">{complete ? 'Mission accomplished.' : mission?.completed.length ? 'Pick up where you left off.' : 'Your next mission'}</h2></div>
        <div className={`mission-mascot${complete ? ' is-celebrating' : ' is-waving'}`}><Mascot mood={complete ? 'happy' : 'curious'} /></div>
      </div>
      <p className="mission-objective">{complete ? 'You made time to practise. That’s how good habits stick.' : includesCalls ? 'Read a text, investigate an email, and handle a caller. Make the call on what you’d do.' : 'Read the message, check the details, then decide what you’d do.'}</p>
      <MissionProgress mission={mission} />
      <div className="mission-focus"><span>{loading ? 'Finding your next focus…' : next.title.replace(/, made for you$/, '')}</span><span>{levelName(next.difficulty)} practice</span></div>
      <div className="mission-start">
        <button type="button" className="train-primary" disabled={pending || !uid} aria-busy={pending} onClick={() => void start()}>
          {pending ? <><LoaderCircle size={17} className="spinner" aria-hidden="true" />Preparing your mission…</> : <>{failure ? 'Retry' : complete ? 'Start another mission' : mission ? 'Continue mission' : 'Start mission'}<ArrowRight size={17} aria-hidden="true" /></>}
        </button>
        <span>{includesCalls ? 'Text, email & call' : 'Texts & emails'}</span>
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
