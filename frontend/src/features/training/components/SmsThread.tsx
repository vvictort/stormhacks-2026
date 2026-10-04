import { Globe, LockKeyhole } from 'lucide-react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { useEffect, useId, useState } from 'react'
import { spring } from '../../../lib/motion'
import { markFor, markText, siteOf, type Indicator, type SmsMessage, type SmsScenario } from '../scenarios'

interface ThreadProps {
  scenario: SmsScenario
  /** After a decision, indicators are marked in the text. */
  revealed: boolean
  onInspect: () => void
}

/** How many messages have "arrived". Each one is preceded by a typing indicator, like a real phone. */
function useArrivals(total: number, instant: boolean) {
  const [arrived, setArrived] = useState(0)
  useEffect(() => {
    if (instant) return
    // First message after a short beat; later ones after the sender "types" for a moment.
    const timers = Array.from({ length: total }, (_, i) => window.setTimeout(() => setArrived(i + 1), 1050 + i * 1350))
    return () => timers.forEach(window.clearTimeout)
  }, [total, instant])
  return instant ? total : arrived
}

export function MessageThread({ scenario, revealed, onInspect }: ThreadProps) {
  const indicators = revealed ? scenario.indicators : []
  const clueLabel = scenario.correctAction === 'report' ? 'red flag' : 'good sign'
  const reduce = useReducedMotion()
  const arrived = useArrivals(scenario.messages.length, Boolean(reduce) || revealed)
  const typing = arrived < scenario.messages.length

  return (
    <div className="sms-thread" role="region" aria-label="Conversation" tabIndex={0}>
      <p className="sms-day">Today {scenario.receivedAt}</p>
      {/* Polite live region: screen readers hear each message arrive, as on a real phone. */}
      <ol className="sms-list" aria-live="polite">
        <AnimatePresence initial={false}>
          {scenario.messages.slice(0, arrived).map((message, i) => (
            <MessageBubble key={i} message={message} indicators={indicators} clueLabel={clueLabel} onInspect={onInspect} />
          ))}
          {typing && (
            <m.li key="typing" className="sms-typing" aria-hidden="true" layout
              initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.12 } }}
              transition={spring}>
              <span /><span /><span />
            </m.li>
          )}
        </AnimatePresence>
      </ol>
    </div>
  )
}

interface BubbleProps {
  message: SmsMessage
  indicators: Indicator[]
  clueLabel: string
  onInspect: () => void
}

export function MessageBubble({ message, indicators, clueLabel, onInspect }: BubbleProps) {
  return (
    // Grows out of the typing indicator's corner.
    <m.li className="sms-bubble" layout initial={{ opacity: 0, scale: 0.7, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={spring}>
      <p><Marked text={message.text} indicators={indicators} clueLabel={clueLabel} /></p>
      {message.link && <LinkPreview url={message.link} mark={markFor(message.link, indicators)} clueLabel={clueLabel} onInspect={onInspect} />}
    </m.li>
  )
}

/** Text with any quoted indicators wrapped in numbered clues. */
export function Marked({ text, indicators, clueLabel }: { text: string; indicators: Indicator[]; clueLabel: string }) {
  return markText(text, indicators).map((segment, i) => segment.mark
    ? <Clue key={i} n={segment.mark} label={clueLabel}>{segment.text}</Clue>
    : segment.text)
}

function Clue({ n, label, children }: { n: number; label: string; children: string }) {
  // Keep the number with the first word so it never sits alone at a line end.
  const space = children.indexOf(' ')
  const head = space < 0 ? children : children.slice(0, space)
  return (
    <mark className="clue">
      <span className="clue-head"><span className="clue-num" aria-hidden="true">{n}</span>{head}</span>
      {space < 0 ? '' : children.slice(space)}
      <span className="sr-only"> ({label} {n})</span>
    </mark>
  )
}

/** A link you can inspect but never follow: it is a button, not an anchor. */
export function LinkPreview({ url, mark, clueLabel, onInspect }: { url: string; mark?: number; clueLabel: string; onInspect: () => void }) {
  const [open, setOpen] = useState(false)
  const panel = useId()

  return (
    <>
      <button
        type="button"
        className={`sms-link${mark ? ' is-marked' : ''}`}
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => {
          if (!open) onInspect()
          setOpen(!open)
        }}
      >
        {mark && <span className="clue-num" aria-hidden="true">{mark}</span>}
        {url}
        <span className="sr-only">{mark ? ` (${clueLabel} ${mark})` : ''}, inspect link</span>
      </button>
      {/* Springs open like a link preview sheet; inert while closed so it can't take focus. */}
      <m.div id={panel} className="sms-inspect-wrap" initial={false} inert={!open} aria-hidden={!open}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }} transition={open ? spring : { duration: 0.18, ease: 'easeOut' }}>
        <div className="sms-inspect">
          <p className="sms-inspect-note"><LockKeyhole size={13} aria-hidden="true" /> Practice link. It won't open.</p>
          <p className="sms-inspect-site"><Globe size={15} aria-hidden="true" /> <span>Website: <strong>{siteOf(url)}</strong></span></p>
          <p className="sms-inspect-url">{url}</p>
        </div>
      </m.div>
    </>
  )
}
