import { ArrowRight, Check, CircleAlert, Lightbulb } from 'lucide-react'
import { m, useReducedMotion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Mascot } from '../../../components/Mascot'
import { TransitionLink } from '../../../components/TransitionLink'
import { spring } from '../../../lib/motion'
import { debriefActions } from '../adaptive'
import { voiceCredit } from '../attribution'
import { NewBadges } from '../components/MissionCard'
import { missionComplete, type BadgeId, type Mission } from '../missions'
import type { Scenario } from '../scenarios'
import type { CallDebriefView, Moment } from './callModel'

/** After a call: the result (from callOutcome, never decided here), the warning signs, and moments from the redacted transcript. */
export function CallDebrief({ view, next, callerLabel, learned, mission, missionHref, earnedNow = [], retry }: { view: CallDebriefView; next?: Scenario; callerLabel: string; learned?: ReactNode; mission?: Mission | null; missionHref?: string; earnedNow?: BadgeId[]; retry?: { live: () => void; captions: () => void } }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const reduce = useReducedMotion()
  const complete = mission && missionComplete(mission)
  const credit = voiceCredit(view)
  // One next step: the adaptive panel's "Next scenario made for you" when it shows, the path's next otherwise.
  const actions = debriefActions({ hasNext: Boolean(next), adaptive: Boolean(learned) })
  useEffect(() => heading.current?.focus(), [])
  // One list that reads by tone: the slip leads when the caller got through.
  const good = view.didWell.map((line) => [true, line] as const)
  const slip = view.nearMiss ? [[false, view.nearMiss.line] as const] : []
  const notes = view.tone === 'missed' ? [...slip, ...good] : [...good, ...slip]
  // The caller's ask is only quoted up top as part of a near-miss pair; otherwise it joins the transcript moments.
  const moments = view.ask && !view.nearMiss?.exchange?.reply ? [view.ask, ...view.moments] : view.moments

  return (
    <m.section className={`debrief call-debrief is-${view.tone}`} aria-labelledby="debrief-title"
      initial={reduce ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : { ...spring, stiffness: 300 }}>
      <div className="debrief-verdict">
        <m.span className="debrief-mascot-pop" initial={reduce ? false : { scale: 0.5, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={reduce ? { duration: 0 } : { ...spring, delay: 0.12 }}>
          <Mascot className="debrief-mascot" mood={complete ? 'happy' : view.mood} />
        </m.span>
        <h2 id="debrief-title" ref={heading} tabIndex={-1}>{view.title}</h2>
      </div>
      <p className="debrief-lede"><strong>{view.outcomeLine}</strong> {view.explanation}</p>
      <NewBadges ids={earnedNow} />
      {complete && <p className="debrief-mission-complete" role="status"><strong>Mission accomplished.</strong>Three scenarios completed. Ready for your next adventure?</p>}
      {mission && <div className="debrief-actions">
        {retry ? <><button type="button" className="train-primary" onClick={retry.live}>Retry call</button><button type="button" className="train-ghost" onClick={retry.captions}>Use captions</button></>
          : complete ? <TransitionLink className="train-primary" to="/home">See your mission rewards<ArrowRight size={17} aria-hidden="true" /></TransitionLink>
          : missionHref ? <TransitionLink className="train-primary" to={missionHref}>Continue mission<ArrowRight size={17} aria-hidden="true" /></TransitionLink> : null}
        {!complete && <TransitionLink direction="back" className="train-ghost" to="/home">Back to home</TransitionLink>}
      </div>}

      <p className="call-pretext">{view.pretext}</p>
      {view.tactics.length > 0 && <ul className="call-tactics" aria-label="Tactics the caller used">{view.tactics.map((tactic) => <li key={tactic}>{tactic}</li>)}</ul>}

      {notes.length > 0 && (
        <>
          <h3>{view.tone === 'missed' ? 'Where the caller got through' : 'What you resisted'}</h3>
          <ul className="call-list">
            {notes.map(([good, line]) => (
              <li key={line} className={good ? 'is-good' : 'is-slip'}>
                {good ? <Check size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}<span>{line}</span>
              </li>
            ))}
          </ul>
          {view.nearMiss?.exchange?.reply && <Quotes callerLabel={callerLabel} moments={[view.nearMiss.exchange.ask, view.nearMiss.exchange.reply]} />}
        </>
      )}

      <h3>Warning signs</h3>
      <ul className="call-signs" aria-label="Warning signs in this call">
        {view.warningSigns.map((sign) => (
          <li key={sign.title}><details><summary>{sign.title}</summary><p>{sign.detail}</p></details></li>
        ))}
      </ul>

      <p className="call-tip"><Lightbulb size={18} aria-hidden="true" /><span>{view.recommendation}</span></p>

      {moments.length > 0 && (
        <details className="call-transcript">
          <summary>See moments from the call</summary>
          <p className="debrief-hint">From the saved transcript, with personal details removed.</p>
          <Quotes callerLabel={callerLabel} moments={moments} />
        </details>
      )}

      {view.practice && <p className="call-debrief-note">Caption-only practice result. It's saved in this browser only.</p>}
      {credit && <p className="call-debrief-note">{credit}</p>}

      {learned}

      {!mission && <div className="debrief-actions">
        {actions.pathNext && next && <TransitionLink className="train-primary" to={`/train/${next.id}`}>Next scenario<ArrowRight size={17} aria-hidden="true" /></TransitionLink>}
        <TransitionLink direction="back" className={actions.homePrimary ? 'train-primary' : 'train-ghost'} to="/home">Back to home</TransitionLink>
      </div>}
    </m.section>
  )
}

/** Redacted transcript lines (never live captions). */
function Quotes({ moments, callerLabel }: { moments: Moment[]; callerLabel: string }) {
  return (
    <ol className="call-moments">
      {moments.map((moment, i) => (
        <li key={i} className={`is-${moment.role}`}>
          <span className="call-moment-meta">{moment.role === 'agent' ? callerLabel : 'You'} · {moment.time}</span>
          <q>{moment.message}</q>
        </li>
      ))}
    </ol>
  )
}
