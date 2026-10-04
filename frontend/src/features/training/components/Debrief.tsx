import { ArrowRight, ChevronDown } from 'lucide-react'
import { m, useReducedMotion } from 'motion/react'
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Mascot } from '../../../components/Mascot'
import { TransitionLink } from '../../../components/TransitionLink'
import { spring } from '../../../lib/motion'
import { debriefActions } from '../adaptive'
import { confidenceLabels, type Confidence, type FlagScore } from '../flagging'
import { missionComplete, type BadgeId, type Mission } from '../missions'
import { hasLink, type Action, type MessageScenario, type Scenario } from '../scenarios'
import { NewBadges } from './MissionCard'

interface DebriefProps {
  scenario: MessageScenario
  choice: Action
  confidence?: Confidence | null
  flagScore?: FlagScore | null
  inspectedLink?: boolean
  inspectedSender?: boolean
  flaggedCount?: number
  next?: Scenario
  learned?: ReactNode
  mission?: Mission | null
  missionHref?: string
  earnedNow?: BadgeId[]
}

export function Debrief({ scenario, choice, confidence, flagScore, inspectedLink = false, inspectedSender = false, flaggedCount = 0, next, learned, mission, missionHref, earnedNow = [] }: DebriefProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const reduce = useReducedMotion()
  const correct = choice === scenario.correctAction
  const isScam = scenario.correctAction === 'report'
  const complete = mission && missionComplete(mission)
  const habits = [
    inspectedLink && hasLink(scenario) && 'You previewed the link before deciding.',
    inspectedSender && scenario.type === 'email' && 'You checked the sender address before deciding.',
    flaggedCount > 0 && 'You paused to flag suspicious phrasing.',
  ].filter((habit): habit is string => Boolean(habit))
  const actions = debriefActions({ hasNext: Boolean(next), adaptive: Boolean(learned) })
  const title = correct ? (isScam ? 'Good catch.' : "Right call. This one's genuine.") : (isScam ? "Not quite. Here's what gave it away." : 'Not quite. This one was genuine.')
  useEffect(() => heading.current?.focus(), [])

  return <m.section className={`debrief ${correct ? 'is-correct' : 'is-missed'}${isScam ? '' : ' is-safe-scenario'}`} aria-labelledby="debrief-title"
    initial={reduce ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : { ...spring, stiffness: 300 }}>
    <div className="debrief-verdict">
      <m.span className="debrief-mascot-pop" initial={reduce ? false : { scale: .5, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={reduce ? { duration: 0 } : { ...spring, delay: .12 }}>
        <Mascot className="debrief-mascot" mood={correct || complete ? 'happy' : 'curious'} />
      </m.span>
      <h2 id="debrief-title" ref={heading} tabIndex={-1}>{title}</h2>
    </div>
    <p className="debrief-lede">{correct ? (isScam ? 'You spotted the manipulation.' : 'You gave a genuine message the right call.') : 'This is a safe place to learn. One useful check will help next time.'}{mission && ' Another step completed.'}</p>

    {flagScore && isScam && <div className="debrief-flag-score" aria-label="Flagging accuracy breakdown">
      <h4>Phrases you flagged</h4>
      <div className="flag-score-chips">
        <span className="flag-chip is-caught"><strong>{flagScore.caught}</strong> of {flagScore.totalIndicators} red flags caught</span>
        {flagScore.missed > 0 && <span className="flag-chip is-missed"><strong>{flagScore.missed}</strong> to look for</span>}
        {flagScore.wrong > 0 && <span className="flag-chip is-wrong"><strong>{flagScore.wrong}</strong> false alarm{flagScore.wrong === 1 ? '' : 's'}</span>}
      </div>
    </div>}
    {habits.length > 0 && <div className="debrief-habits"><h3>Checks you made</h3><ul>{habits.map(habit => <li key={habit} className="debrief-habit">{habit}</li>)}</ul></div>}
    <NewBadges ids={earnedNow} />
    {complete && <p className="debrief-mission-complete" role="status"><strong>Mission accomplished.</strong>Three scenarios completed. Ready for your next adventure?</p>}
    <p className="debrief-tip"><strong>For next time</strong>{scenario.nextTime}</p>

    <div className="debrief-actions">
      {missionHref ? <TransitionLink className="train-primary" to={missionHref}>Continue mission<ArrowRight size={17} aria-hidden="true" /></TransitionLink>
        : complete ? <TransitionLink className="train-primary" to="/home">See your mission rewards<ArrowRight size={17} aria-hidden="true" /></TransitionLink>
        : actions.pathNext && next ? <TransitionLink className="train-primary" to={`/train/${next.id}`}>Next scenario<ArrowRight size={17} aria-hidden="true" /></TransitionLink> : null}
      {!complete && <TransitionLink direction="back" className={!mission && actions.homePrimary ? 'train-primary' : 'train-ghost'} to="/home">Back to home</TransitionLink>}
    </div>
    <details className="debrief-more">
      <summary>{isScam ? 'Explore the clues' : 'Why this message checks out'}<ChevronDown size={17} aria-hidden="true" /></summary>
      <p>{scenario.explanation}</p>
      {confidence && <p className="debrief-confidence">You felt <strong>{confidenceLabels[confidence].toLowerCase()}</strong>{!correct && confidence === 'certain' ? '. Next time, check one detail before trusting that first impression.' : '.'}</p>}
      <ol className="debrief-clues">{scenario.indicators.map((indicator, i) => <li key={indicator.title} style={{ '--n': i } as CSSProperties}>
        <details><summary><span className="clue-num" aria-hidden="true">{i + 1}</span><strong>{indicator.title}</strong></summary><p>{indicator.detail}</p></details>
      </li>)}</ol>
    </details>
    {learned}
  </m.section>
}
