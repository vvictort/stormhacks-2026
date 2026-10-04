import { ArrowRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Mascot } from '../../../components/Mascot'
import { hasLink, type Action, type Scenario } from '../scenarios'

interface DebriefProps {
  scenario: Scenario
  choice: Action
  inspected: boolean
  next?: Scenario
}

export function Debrief({ scenario, choice, inspected, next }: DebriefProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const correct = choice === scenario.correctAction
  const isScam = scenario.correctAction === 'report'
  const title = correct
    ? (isScam ? 'Good catch.' : "Right call. This one's genuine.")
    : (isScam ? "Not quite. Here's what gave it away." : 'Not quite. This one was genuine.')

  // Moving focus announces the result and, on small screens, scrolls the debrief into view.
  useEffect(() => heading.current?.focus(), [])

  return (
    <section className={`debrief ${correct ? 'is-correct' : 'is-missed'}${isScam ? '' : ' is-safe-scenario'}`} aria-labelledby="debrief-title">
      <div className="debrief-verdict">
        <Mascot className="debrief-mascot" mood={correct ? 'happy' : isScam ? 'alert' : 'curious'} />
        <h2 id="debrief-title" ref={heading} tabIndex={-1}>{title}</h2>
      </div>
      <p className="debrief-lede">{scenario.explanation}</p>

      <h3>{isScam ? `Red flags in this ${scenario.type === 'email' ? 'email' : 'message'}` : 'Why it checks out'}</h3>
      <p className="debrief-hint">The numbers match the highlights on the phone.</p>
      <ol className="debrief-clues">
        {scenario.indicators.map((indicator, i) => (
          <li key={indicator.title}>
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
        {next && <Link className="train-primary" to={`/train/${next.id}`}>Next scenario<ArrowRight size={17} aria-hidden="true" /></Link>}
        <Link className={next ? 'train-ghost' : 'train-primary'} to="/home">Back to home</Link>
      </div>
    </section>
  )
}
