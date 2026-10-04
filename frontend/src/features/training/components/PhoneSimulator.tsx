import { Check, Flag, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { Action, Scenario } from '../scenarios'
import { AppHeader, PhoneFrame } from './PhoneFrame'
import { MessageThread } from './SmsThread'

interface SimulatorProps {
  scenario: Scenario
  choice: Action | null
  onChoose: (action: Action) => void
  onInspect: () => void
}

export function PhoneSimulator({ scenario, choice, onChoose, onInspect }: SimulatorProps) {
  return (
    <section className={`phone-wrap${scenario.correctAction === 'safe' ? ' is-safe-scenario' : ''}`} aria-label="Practice phone">
      <PhoneFrame time={scenario.receivedAt}>
        {/* One renderer per channel; email and call screens slot in here. */}
        {scenario.type === 'sms' && (
          <>
            <AppHeader label="Text messages from" title={scenario.sender} subtitle="Not in your contacts" />
            <MessageThread scenario={scenario} revealed={choice !== null} onInspect={onInspect} />
          </>
        )}
        <ResponseControls choice={choice} onChoose={onChoose} />
      </PhoneFrame>
    </section>
  )
}

export function ResponseControls({ choice, onChoose }: { choice: Action | null; onChoose: (action: Action) => void }) {
  if (choice) {
    return (
      <p className="phone-decided">
        {choice === 'report'
          ? <><Flag size={15} aria-hidden="true" /> You reported and blocked this number.</>
          : <><Check size={15} aria-hidden="true" /> You marked this message as safe.</>}
      </p>
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
