import { Ban, Check } from 'lucide-react'
import { m, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { spring } from '../../../lib/motion'
import { haptic } from '../../../lib/viewTransition'
import { confidenceLabels, type Confidence } from '../flagging'
import type { Action, MessageScenario } from '../scenarios'
import { EmailView } from './EmailView'
import { AppHeader, PhoneFrame } from './PhoneFrame'
import { MessageThread } from './SmsThread'

interface SimulatorProps {
  scenario: MessageScenario
  choice: Action | null
  confidence: Confidence | null
  flaggedPhrases: string[]
  onToggleFlag: (phrase: string) => void
  onChoose: (action: Action, confidence: Confidence) => void
  onInspect: (target: 'link' | 'sender', url?: string) => void
}

export function PhoneSimulator({
  scenario,
  choice,
  confidence,
  flaggedPhrases,
  onToggleFlag,
  onChoose,
  onInspect,
}: SimulatorProps) {
  return (
    <section className={`phone-wrap${scenario.correctAction === 'safe' ? ' is-safe-scenario' : ''}`} aria-label="Practice phone">
      <PhoneFrame time={scenario.receivedAt}>
        {scenario.type === 'sms' && (
          <>
            <AppHeader label="Text messages from" title={scenario.sender} subtitle="Not in your contacts" />
            <MessageThread
              scenario={scenario}
              revealed={choice !== null}
              onInspect={onInspect}
              flaggedPhrases={flaggedPhrases}
              onToggleFlag={onToggleFlag}
            />
          </>
        )}
        {scenario.type === 'email' && (
          <EmailView
            scenario={scenario}
            revealed={choice !== null}
            onInspect={onInspect}
            flaggedPhrases={flaggedPhrases}
            onToggleFlag={onToggleFlag}
          />
        )}
        <ResponseControls
          choice={choice}
          confidence={confidence}
          flaggedCount={flaggedPhrases.length}
          onChoose={(action, conf) => {
            haptic()
            onChoose(action, conf)
          }}
        />
      </PhoneFrame>
    </section>
  )
}

export function ResponseControls({
  choice,
  confidence,
  flaggedCount = 0,
  onChoose,
}: {
  choice: Action | null
  confidence: Confidence | null
  flaggedCount?: number
  onChoose: (action: Action, confidence: Confidence) => void
}) {
  const reduce = useReducedMotion()
  const [pendingAction, setPendingAction] = useState<Action | null>(null)

  if (choice) {
    const confLabel = confidence ? confidenceLabels[confidence] : ''
    return (
      <m.div
        className={`phone-decided is-${choice}`}
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : spring}
      >
        <div>
          <p>
            {choice === 'report' ? (
              <>
                <Ban size={16} aria-hidden="true" />
                Reported &amp; blocked
              </>
            ) : (
              <>
                <Check size={16} aria-hidden="true" />
                Marked as safe
              </>
            )}
          </p>
          {confLabel && <span className="phone-decided-conf">{confLabel}</span>}
        </div>
      </m.div>
    )
  }

  if (pendingAction) {
    return (
      <div className="phone-actions phone-actions-conf" role="group" aria-labelledby="conf-label">
        <div className="phone-conf-head">
          <p id="conf-label">How sure are you?</p>
          <button
            type="button"
            className="text-link phone-change-btn"
            onClick={() => setPendingAction(null)}
          >
            Change decision
          </button>
        </div>
        <div className="phone-conf-buttons">
          <button
            type="button"
            onClick={() => onChoose(pendingAction, 'guessing')}
          >
            Guessing
          </button>
          <button
            type="button"
            onClick={() => onChoose(pendingAction, 'fairly_sure')}
          >
            Fairly sure
          </button>
          <button
            type="button"
            onClick={() => onChoose(pendingAction, 'certain')}
          >
            Certain
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="phone-actions" role="group" aria-labelledby="decide-label">
      <div className="phone-actions-hint" role="status" aria-live="polite">
        {flaggedCount > 0 ? (
          <span>{flaggedCount} phrase{flaggedCount === 1 ? '' : 's'} flagged</span>
        ) : (
          <span>Tap suspicious phrases to flag them</span>
        )}
      </div>
      <p id="decide-label" className="sr-only">What would you do?</p>
      <div className="phone-decision-buttons">
        <button type="button" onClick={() => setPendingAction('safe')}>
          Looks safe
        </button>
        <button type="button" onClick={() => setPendingAction('report')}>
          Report &amp; block
        </button>
      </div>
    </div>
  )
}
