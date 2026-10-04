import { ArrowRight, Award, Check, LoaderCircle, Mail, MessageSquareText, RotateCcw, Sparkles } from 'lucide-react'
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

const badgeIcons = { 'first-steps': Sparkles, 'good-catch': Award, comeback: RotateCcw }
export function BadgeCollection({ earned }: { earned: Partial<Record<BadgeId, number>> }) {
  return <section className="badge-collection" aria-labelledby="badges-title">
    <div className="home-section-head"><h2 id="badges-title">Little wins, lasting instincts</h2><span>{Object.keys(earned).length} of 3 earned</span></div>
    <ul>{badges.map(badge => {
      const Icon = badgeIcons[badge.id]
      return <li key={badge.id} className={earned[badge.id] !== undefined ? 'is-earned' : ''}>
        <span className="badge-icon" aria-hidden="true"><Icon size={22} /></span>
        <div><strong>{badge.name}</strong><span className="badge-status">{earned[badge.id] !== undefined ? 'Earned' : 'To earn'}</span><p>{badge.condition}</p></div>
      </li>
    })}</ul>
  </section>
}

export function NewBadges({ ids }: { ids: BadgeId[] }) {
  if (!ids.length) return null
  return <div className="new-badges" role="status">
    {ids.map(id => <p key={id}><Award size={18} aria-hidden="true" /><span><strong>{badges.find(b => b.id === id)!.name} earned!</strong> {badges.find(b => b.id === id)!.condition}</span></p>)}
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
        <div><p className="mission-eyebrow"><Sparkles size={15} aria-hidden="true" />A little practice. A sharper instinct.</p>
          <h2 id="mission-title">{complete ? 'Mission accomplished.' : 'Your next mission'}</h2></div>
        <div className={`mission-mascot${complete ? ' is-celebrating' : ' is-waving'}`}><Mascot mood={complete ? 'happy' : 'curious'} /></div>
      </div>
      <p className="mission-objective">{complete ? 'Three messages investigated. Every decision helped you learn.' : 'Investigate three messages. Work out what deserves your trust.'}</p>
      <MissionProgress mission={mission} />
      <div className="mission-focus"><span>{loading ? 'Finding your next focus…' : next.title.replace(/, made for you$/, '')}</span><span>{levelName(next.difficulty)}</span></div>
      <div className="mission-start">
        <button type="button" className="train-primary" disabled={pending || !uid} aria-busy={pending} onClick={() => void start()}>
          {pending ? <><LoaderCircle size={17} className="spinner" aria-hidden="true" />Preparing your mission…</> : <>{failure ? 'Retry' : complete ? 'Start another mission' : mission ? 'Continue mission' : 'Start mission'}<ArrowRight size={17} aria-hidden="true" /></>}
        </button>
        <span><Mail size={15} aria-hidden="true" /><MessageSquareText size={15} aria-hidden="true" />Texts &amp; emails</span>
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
