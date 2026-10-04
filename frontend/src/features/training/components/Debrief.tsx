import { ArrowRight, Check, ChevronDown, Lightbulb } from 'lucide-react'
import { m, useReducedMotion } from 'motion/react'
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Mascot } from '../../../components/Mascot'
import { RevealText } from '../../../components/RevealText'
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
  const heading = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  const correct = choice === scenario.correctAction
  const isScam = scenario.correctAction === 'report'
  const complete = mission && missionComplete(mission)
  const actions = debriefActions({ hasNext: Boolean(next), adaptive: Boolean(learned) })
  const title = correct ? (isScam ? 'Good catch.' : "Right call. This one's genuine.") : (isScam ? "Not quite. Here's what gave it away." : 'Not quite. This one was genuine.')
  useEffect(() => heading.current?.focus(), [])

  return <m.section className={`debrief ${correct ? 'is-correct' : 'is-missed'}${isScam ? '' : ' is-safe-scenario'}`} aria-labelledby="debrief-title"
    initial={reduce ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : { ...spring, stiffness: 300 }}>
    <div className="debrief-verdict">
      <m.span className="debrief-mascot-pop" initial={reduce ? false : { scale: .5, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={reduce ? { duration: 0 } : { ...spring, delay: .12 }}>
        <Mascot className="debrief-mascot" mood={correct || complete ? 'happy' : 'curious'} />
      </m.span>
      <RevealText as="h2" id="debrief-title" ref={heading} tabIndex={-1} text={title} delay={140} />
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
    <div className="debrief-habits">
      {inspectedLink && hasLink(scenario) && <p className="debrief-habit"><Check size={14} aria-hidden="true" />You previewed the link before deciding. Good habit.</p>}
      {inspectedSender && scenario.type === 'email' && <p className="debrief-habit"><Check size={14} aria-hidden="true" />You checked the sender address before deciding.</p>}
      {flaggedCount > 0 && <p className="debrief-habit"><Check size={14} aria-hidden="true" />You paused to flag suspicious phrasing.</p>}
    </div>
    <NewBadges ids={earnedNow} />
    {complete && <p className="debrief-mission-complete" role="status"><Check size={18} aria-hidden="true" /><span><strong>Mission accomplished.</strong> Three messages investigated. Ready for your next adventure?</span></p>}
    <p className="debrief-tip"><Lightbulb size={16} aria-hidden="true" /><span><strong>Take this with you: </strong>{scenario.nextTime}</span></p>

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
