import { Ban, Check, Flag, ShieldAlert, ShieldCheck } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useState } from 'react'
import { spring } from '../../../lib/motion'
import { haptic } from '../../../lib/viewTransition'
import type { Action, Scenario } from '../scenarios'
import { EmailView } from './EmailView'
import { AppHeader, PhoneFrame } from './PhoneFrame'
import { MessageThread } from './SmsThread'

interface SimulatorProps {
  scenario: Scenario
  choice: Action | null
  onChoose: (action: Action) => void
  onInspect: () => void
}

export function PhoneSimulator({ scenario, choice, onChoose, onInspect }: SimulatorProps) {
  // The system banner drops in after a decision, then tucks itself away. (One decision per run.)
  const [bannerDone, setBannerDone] = useState(false)
  const banner = choice !== null && !bannerDone
  useEffect(() => {
    if (!choice) return
    const timer = window.setTimeout(() => setBannerDone(true), 2400)
    return () => window.clearTimeout(timer)
  }, [choice])

  return (
    <section className={`phone-wrap${scenario.correctAction === 'safe' ? ' is-safe-scenario' : ''}`} aria-label="Practice phone">
      <PhoneFrame time={scenario.receivedAt}>
        {/* One renderer per channel; the call screen slots in here. */}
        {scenario.type === 'sms' && (
          <>
            <AppHeader label="Text messages from" title={scenario.sender} subtitle="Not in your contacts" />
            <MessageThread scenario={scenario} revealed={choice !== null} onInspect={onInspect} />
          </>
        )}
        {scenario.type === 'email' && <EmailView scenario={scenario} revealed={choice !== null} onInspect={onInspect} />}
        <ResponseControls channel={scenario.type} choice={choice} onChoose={(action) => { haptic(); onChoose(action) }} />
        <AnimatePresence>
          {banner && (
            // Decorative echo of the decision; the status line below says the same thing to assistive tech.
            <m.div key="banner" className="phone-banner" aria-hidden="true"
              initial={{ y: '-130%', opacity: 0.6 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-130%', opacity: 0, transition: { duration: 0.22, ease: 'easeIn' } }}
              transition={spring}>
              <span className={`phone-banner-icon is-${choice}`}>{choice === 'report' ? <Ban size={16} /> : <ShieldCheck size={16} />}</span>
              <span><strong>{choice === 'report' ? (scenario.type === 'email' ? 'Sender blocked' : 'Number blocked') : 'Marked as safe'}</strong>
                {choice === 'report' ? 'Reported as a likely scam.' : scenario.type === 'email' ? 'Kept in your inbox.' : 'Kept in your messages.'}</span>
            </m.div>
          )}
        </AnimatePresence>
      </PhoneFrame>
    </section>
  )
}

export function ResponseControls({ channel, choice, onChoose }: { channel: Scenario['type']; choice: Action | null; onChoose: (action: Action) => void }) {
  const email = channel === 'email'
  if (choice) {
    return (
      <m.p className="phone-decided" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        {choice === 'report'
          ? <><Flag size={15} aria-hidden="true" /> {email ? 'You reported this email and blocked the sender.' : 'You reported and blocked this number.'}</>
          : <><Check size={15} aria-hidden="true" /> You marked this {email ? 'email' : 'message'} as safe.</>}
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
