import { ArrowRight } from 'lucide-react'
import { m } from 'motion/react'
import { useEffect, useRef, type CSSProperties } from 'react'
import { Mascot } from '../../../components/Mascot'
import { RevealText } from '../../../components/RevealText'
import { TransitionLink } from '../../../components/TransitionLink'
import { spring } from '../../../lib/motion'
import { hasLink, type Action, type MessageScenario, type Scenario } from '../scenarios'

interface DebriefProps {
  scenario: MessageScenario
  choice: Action
  inspected: boolean
  next?: Scenario
}

export function Debrief({ scenario, choice, inspected, next }: DebriefProps) {
  const heading = useRef<HTMLElement>(null)
  const correct = choice === scenario.correctAction
  const isScam = scenario.correctAction === 'report'
  const title = correct
    ? (isScam ? 'Good catch.' : "Right call. This one's genuine.")
    : (isScam ? "Not quite. Here's what gave it away." : 'Not quite. This one was genuine.')

  // Moving focus announces the result and, on small screens, scrolls the debrief into view.
  useEffect(() => heading.current?.focus(), [])

  return (
    // Slides up like a sheet; the verdict then arrives word by word.
    <m.section className={`debrief ${correct ? 'is-correct' : 'is-missed'}${isScam ? '' : ' is-safe-scenario'}`} aria-labelledby="debrief-title"
      initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, stiffness: 300 }}>
      <div className="debrief-verdict">
        <m.span className="debrief-mascot-pop" initial={{ scale: 0.5, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ ...spring, delay: 0.12 }}>
          <Mascot className="debrief-mascot" mood={correct ? 'happy' : isScam ? 'alert' : 'curious'} />
        </m.span>
        <RevealText as="h2" id="debrief-title" ref={heading} tabIndex={-1} text={title} delay={140} />
      </div>
      <p className="debrief-lede">{scenario.explanation}</p>

      <h3>{isScam ? `Red flags in this ${scenario.type === 'email' ? 'email' : 'message'}` : 'Why it checks out'}</h3>
      <p className="debrief-hint">The numbers match the highlights on the phone.</p>
      <ol className="debrief-clues">
        {scenario.indicators.map((indicator, i) => (
          <li key={indicator.title} style={{ '--n': i } as CSSProperties}>
            <span className="clue-num" aria-hidden="true">{i + 1}</span>
            <div>
              <strong>{indicator.title}</strong>
              <p>{indicator.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {!correct && (
        <div className="debrief-next">
          <h3>Next time</h3>
          <p>{scenario.nextTime}</p>
        </div>
      )}
      {inspected && hasLink(scenario) && (
        <p className="debrief-habit">You checked the link before deciding. That's a habit worth keeping.</p>
      )}

      <div className="debrief-actions">
        {next && <TransitionLink className="train-primary" to={`/train/${next.id}`}>Next scenario<ArrowRight size={17} aria-hidden="true" /></TransitionLink>}
        <TransitionLink direction="back" className={next ? 'train-ghost' : 'train-primary'} to="/home">Back to home</TransitionLink>
      </div>
    </m.section>
  )
}
