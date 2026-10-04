import { ChevronDown, ChevronLeft, Paperclip } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { markFor, type EmailScenario } from '../scenarios'
import { FlaggableText } from './FlaggableText.tsx'
import { LinkPreview } from './SmsThread.tsx'

interface EmailViewProps {
  scenario: EmailScenario
  /** After a decision, indicators are marked and sender details open. */
  revealed: boolean
  onInspect: (target: 'link' | 'sender', url?: string) => void
  flaggedPhrases?: string[]
  onToggleFlag?: (phrase: string) => void
}

export function EmailView({
  scenario,
  revealed,
  onInspect,
  flaggedPhrases,
  onToggleFlag,
}: EmailViewProps) {
  const indicators = revealed ? scenario.indicators : []
  const clueLabel =
    scenario.correctAction === 'report' ? 'red flag' : 'good sign'
  const mark = (text: string) => (
    <FlaggableText
      text={text}
      revealed={revealed}
      indicators={indicators}
      clueLabel={clueLabel}
      flaggedPhrases={flaggedPhrases}
      onToggleFlag={onToggleFlag}
    />
  )

  return (
    <>
      <div className="phone-app-header email-bar" aria-hidden="true">
        <ChevronLeft size={22} className="phone-app-back" />
        Inbox
      </div>
      <div className="email-view" role="region" aria-label="Email" tabIndex={0}>
        <h2 className="email-subject">
          <span className="sr-only">Email: </span>
          {mark(scenario.subject)}
        </h2>
        {/* Remount on reveal so the details open to show any marked address. */}
        <SenderDetails
          key={String(revealed)}
          scenario={scenario}
          defaultOpen={revealed}
          mark={mark}
          onOpen={() => onInspect('sender')}
        />
        <div className="email-body">
          {scenario.body.map((paragraph, i) => (
            <p key={i}>{mark(paragraph)}</p>
          ))}
        </div>
        {scenario.links?.map((url) => (
          <div key={url} className="email-link">
            <LinkPreview
              url={url}
              mark={markFor(url, indicators)}
              clueLabel={clueLabel}
              onInspect={onInspect}
            />
          </div>
        ))}
        {scenario.attachment && (
          <p className="email-attachment">
            <Paperclip size={16} aria-hidden="true" />
            <span>
              <span className="sr-only">Attachment: </span>
              {mark(scenario.attachment)}
            </span>
          </p>
        )}
      </div>
    </>
  )
}

interface SenderProps {
  scenario: EmailScenario
  defaultOpen: boolean
  mark: (text: string) => ReactNode
  onOpen: () => void
}

/** Like a real mail app: the name shows first, tap it to see the address it really came from. */
function SenderDetails({ scenario, defaultOpen, mark, onOpen }: SenderProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panel = useId()

  return (
    <>
      <div className="email-from">
        <span className="phone-avatar" aria-hidden="true">
          {scenario.fromName[0]}
        </span>
        <div>
          <button
            type="button"
            className="email-sender"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => {
              if (!open) onOpen()
              setOpen(!open)
            }}
          >
            <span className="sr-only">From </span>
            {scenario.fromName}
            <ChevronDown size={16} aria-hidden="true" />
            <span className="sr-only">, show sender details</span>
          </button>
          <p className="email-meta">to me · Today {scenario.receivedAt}</p>
        </div>
      </div>
      <dl id={panel} className="sms-inspect email-details" hidden={!open}>
        <dt>From</dt>
        <dd>{mark(scenario.fromAddress)}</dd>
        {scenario.replyTo && (
          <>
            <dt>Reply-to</dt>
            <dd>{mark(scenario.replyTo)}</dd>
          </>
        )}
        <dt>To</dt>
        <dd>me</dd>
      </dl>
    </>
  )
}
