import { Globe, LockKeyhole } from 'lucide-react'
import { useId, useState, type CSSProperties } from 'react'
import { markFor, markText, siteOf, type Indicator, type SmsMessage, type SmsScenario } from '../scenarios'

interface ThreadProps {
  scenario: SmsScenario
  /** After a decision, indicators are marked in the text. */
  revealed: boolean
  onInspect: () => void
}

export function MessageThread({ scenario, revealed, onInspect }: ThreadProps) {
  const indicators = revealed ? scenario.indicators : []
  const clueLabel = scenario.correctAction === 'report' ? 'red flag' : 'good sign'
  return (
    <div className="sms-thread" role="region" aria-label="Conversation" tabIndex={0}>
      <p className="sms-day">Today {scenario.receivedAt}</p>
      <ol className="sms-list">
        {scenario.messages.map((message, i) => (
          <MessageBubble key={i} index={i} message={message} indicators={indicators} clueLabel={clueLabel} onInspect={onInspect} />
        ))}
      </ol>
    </div>
  )
}

interface BubbleProps {
  index: number
  message: SmsMessage
  indicators: Indicator[]
  clueLabel: string
  onInspect: () => void
}

export function MessageBubble({ index, message, indicators, clueLabel, onInspect }: BubbleProps) {
  return (
    <li className="sms-bubble" style={{ '--i': index } as CSSProperties}>
      <p>
        {markText(message.text, indicators).map((segment, i) => segment.mark
          ? <Clue key={i} n={segment.mark} label={clueLabel}>{segment.text}</Clue>
          : segment.text)}
      </p>
      {message.link && <LinkPreview url={message.link} mark={markFor(message.link, indicators)} clueLabel={clueLabel} onInspect={onInspect} />}
    </li>
  )
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
      <div id={panel} className="sms-inspect" hidden={!open}>
        <p className="sms-inspect-note"><LockKeyhole size={13} aria-hidden="true" /> Practice link. It won't open.</p>
        <p className="sms-inspect-site"><Globe size={15} aria-hidden="true" /> <span>Website: <strong>{siteOf(url)}</strong></span></p>
        <p className="sms-inspect-url">{url}</p>
      </div>
    </>
  )
}
