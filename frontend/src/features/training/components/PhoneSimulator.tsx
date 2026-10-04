import { Ban, Check, ShieldAlert, ShieldCheck } from 'lucide-react'
import { m } from 'motion/react'
import { spring } from '../../../lib/motion'
import { haptic } from '../../../lib/viewTransition'
import type { Action, MessageScenario } from '../scenarios'
import { EmailView } from './EmailView'
import { AppHeader, PhoneFrame } from './PhoneFrame'
import { MessageThread } from './SmsThread'

interface SimulatorProps {
  scenario: MessageScenario
  choice: Action | null
  onChoose: (action: Action) => void
  onInspect: (target: 'link' | 'sender', url?: string) => void
}

export function PhoneSimulator({ scenario, choice, onChoose, onInspect }: SimulatorProps) {
  return (
    <section className={`phone-wrap${scenario.correctAction === 'safe' ? ' is-safe-scenario' : ''}`} aria-label="Practice phone">
      <PhoneFrame time={scenario.receivedAt}>
        {/* One renderer per channel. Calls have their own lazily loaded screen (features/training/call). */}
        {scenario.type === 'sms' && (
          <>
            <AppHeader label="Text messages from" title={scenario.sender} subtitle="Not in your contacts" />
            <MessageThread scenario={scenario} revealed={choice !== null} onInspect={onInspect} />
          </>
        )}
        {scenario.type === 'email' && <EmailView scenario={scenario} revealed={choice !== null} onInspect={onInspect} />}
        <ResponseControls choice={choice} onChoose={(action) => { haptic(); onChoose(action) }} />
      </PhoneFrame>
    </section>
  )
}

export function ResponseControls({ choice, onChoose }: { choice: Action | null; onChoose: (action: Action) => void }) {
  if (choice) {
    return (
      <m.p className={`phone-decided is-${choice}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        {choice === 'report'
          ? <><Ban size={16} aria-hidden="true" />Reported and blocked</>
          : <><Check size={16} aria-hidden="true" />Marked as safe</>}
      </m.p>
    )
  }

  return (
    <div className="phone-actions" role="group" aria-labelledby="decide-label">
      <p id="decide-label">What would you do?</p>
      <div>
        <button type="button" onClick={() => onChoose('safe')}><ShieldCheck size={18} aria-hidden="true" />Looks safe</button>
        <button type="button" onClick={() => onChoose('report')}><ShieldAlert size={18} aria-hidden="true" />Report &amp; block</button>
      </div>
    </div>
  )
}
