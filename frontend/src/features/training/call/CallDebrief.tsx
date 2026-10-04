import { ArrowRight } from 'lucide-react'
import { m } from 'motion/react'
import { useEffect, useRef, type CSSProperties } from 'react'
import { Mascot } from '../../../components/Mascot'
import { RevealText } from '../../../components/RevealText'
import { TransitionLink } from '../../../components/TransitionLink'
import { spring } from '../../../lib/motion'
import type { Scenario } from '../scenarios'
import type { CallDebriefView } from './callModel'

/** After a call: the result (from callOutcome, never decided here), the warning signs, and moments from the redacted transcript. */
export function CallDebrief({ view, next, callerLabel }: { view: CallDebriefView; next?: Scenario; callerLabel: string }) {
  const heading = useRef<HTMLElement>(null)
  useEffect(() => heading.current?.focus(), [])

  return (
    <m.section className={`debrief call-debrief is-${view.tone}`} aria-labelledby="debrief-title"
      initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, stiffness: 300 }}>
      <div className="debrief-verdict">
        <m.span className="debrief-mascot-pop" initial={{ scale: 0.5, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ ...spring, delay: 0.12 }}>
          <Mascot className="debrief-mascot" mood={view.mood} />
        </m.span>
        <RevealText as="h2" id="debrief-title" ref={heading} tabIndex={-1} text={view.title} delay={140} />
      </div>
      <p className="debrief-lede"><strong>{view.outcomeLine}</strong> {view.explanation}</p>
      {view.practice && <p className="call-debrief-note">Caption-only practice result. It's saved in this browser only.</p>}

      <h3>Warning signs in this call</h3>
      {view.tactics.length > 0 && <ul className="call-tactics" aria-label="Tactics the caller used">{view.tactics.map((tactic) => <li key={tactic}>{tactic}</li>)}</ul>}
      <ol className="debrief-clues">
        {view.warningSigns.map((sign, i) => (
          <li key={sign.title} style={{ '--n': i } as CSSProperties}>
            <span className="clue-num" aria-hidden="true">{i + 1}</span>
            <div><strong>{sign.title}</strong><p>{sign.detail}</p></div>
          </li>
        ))}
      </ol>

      {view.detected.length > 0 && (
        <>
          <h3>What happened on your call</h3>
          <ul className="call-list">{view.detected.map((item) => <li key={item}>{item}</li>)}</ul>
        </>
      )}

      {view.moments.length > 0 && (
        <>
          <h3>Moments from the call</h3>
          <p className="debrief-hint">From the saved transcript, with personal details removed.</p>
          <ol className="call-moments">
            {view.moments.map((moment, i) => (
              <li key={i} className={`is-${moment.role}`}>
                <span className="call-moment-meta">{moment.role === 'agent' ? callerLabel : 'You'} · {moment.time}</span>
                <q>{moment.message}</q>
              </li>
            ))}
          </ol>
        </>
      )}

      {view.didWell.length > 0 && (
        <>
          <h3>What you did well</h3>
          <ul className="call-list is-good">{view.didWell.map((item) => <li key={item}>{item}</li>)}</ul>
        </>
      )}

      <div className="debrief-next">
        <h3>{view.tone === 'success' ? 'Keep in mind' : 'Next time'}</h3>
        {view.improve.map((item) => <p key={item}>{item}</p>)}
      </div>

      <div className="debrief-actions">
        {next && <TransitionLink className="train-primary" to={`/train/${next.id}`}>Next scenario<ArrowRight size={17} aria-hidden="true" /></TransitionLink>}
        <TransitionLink direction="back" className={next ? 'train-ghost' : 'train-primary'} to="/home">Back to home</TransitionLink>
      </div>
    </m.section>
  )
}
