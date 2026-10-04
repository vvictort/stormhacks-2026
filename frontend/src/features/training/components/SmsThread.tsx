import { Globe, LockKeyhole } from 'lucide-react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { spring } from '../../../lib/motion'
import {
  markFor,
  markText,
  siteOf,
  type Indicator,
  type SmsMessage,
  type SmsScenario,
} from '../scenarios'

import { FlaggableText } from './FlaggableText.tsx'

interface ThreadProps {
  scenario: SmsScenario
  /** After a decision, indicators are marked in the text. */
  revealed: boolean
  onInspect: (target: 'link' | 'sender', url?: string) => void
  flaggedPhrases?: string[]
  onToggleFlag?: (phrase: string) => void
}

/**
 * How many messages have "arrived". Each one is preceded by a typing indicator,
 * like a real phone.
 */
function useArrivals(total: number, instant: boolean) {
  const [arrived, setArrived] = useState(0)

  useEffect(() => {
    if (instant) return
    // First message after a short beat; later ones after the sender "types"
    // for a moment.
    const timers = Array.from({ length: total }, (_, i) =>
      window.setTimeout(() => setArrived(i + 1), 1050 + i * 1350),
    )
    return () => timers.forEach(window.clearTimeout)
  }, [total, instant])

  return instant ? total : arrived
}

export function MessageThread({
  scenario,
  revealed,
  onInspect,
  flaggedPhrases,
  onToggleFlag,
}: ThreadProps) {
  const indicators = revealed ? scenario.indicators : []
  const clueLabel =
    scenario.correctAction === 'report' ? 'red flag' : 'good sign'
  const reduce = useReducedMotion()
  const arrived = useArrivals(
    scenario.messages.length,
    Boolean(reduce) || revealed,
  )
  const typing = arrived < scenario.messages.length

  return (
    <div
      className="sms-thread"
      role="region"
      aria-label="Conversation"
      tabIndex={0}
    >
      <p className="sms-day">Today {scenario.receivedAt}</p>
      {/* Polite live region: screen readers hear each message arrive, as on a
          real phone. */}
      <ol className="sms-list" aria-live="polite">
        <AnimatePresence initial={false}>
          {scenario.messages.slice(0, arrived).map((message, i) => (
            <MessageBubble
              key={i}
              message={message}
              indicators={indicators}
              clueLabel={clueLabel}
              onInspect={onInspect}
              flaggedPhrases={flaggedPhrases}
              onToggleFlag={onToggleFlag}
            />
          ))}
          {typing && (
            <m.li
              key="typing"
              className="sms-typing"
              aria-hidden="true"
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.12 } }}
              transition={spring}
            >
              <span />
              <span />
              <span />
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
  onInspect: ThreadProps['onInspect']
  flaggedPhrases?: string[]
  onToggleFlag?: (phrase: string) => void
}

export function MessageBubble({
  message,
  indicators,
  clueLabel,
  onInspect,
  flaggedPhrases,
  onToggleFlag,
}: BubbleProps) {
  return (
    // Grows out of the typing indicator's corner.
    <m.li
      className="sms-bubble"
      layout
      initial={{ opacity: 0, scale: 0.7, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={spring}
    >
      <p>
        <FlaggableText
          text={message.text}
          revealed={Boolean(indicators.length)}
          indicators={indicators}
          clueLabel={clueLabel}
          flaggedPhrases={flaggedPhrases}
          onToggleFlag={onToggleFlag}
        />
      </p>
      {message.link && (
        <LinkPreview
          url={message.link}
          mark={markFor(message.link, indicators)}
          clueLabel={clueLabel}
          onInspect={onInspect}
        />
      )}
    </m.li>
  )
}

/** Text with any quoted indicators wrapped in numbered clues. */
export function Marked({
  text,
  indicators,
  clueLabel,
}: {
  text: string
  indicators: Indicator[]
  clueLabel: string
}) {
  return markText(text, indicators).map((segment, i) =>
    segment.mark ? (
      <Clue
        key={i}
        n={segment.mark}
        indicator={indicators[segment.mark - 1]}
        label={clueLabel}
      >
        {segment.text}
      </Clue>
    ) : (
      segment.text
    ),
  )
}

/**
 * A marked clue: hover or focus previews what it means, a click pins it open.
 */
function Clue({
  n,
  indicator,
  label,
  children,
}: {
  n: number
  indicator: Indicator
  label: string
  children: string
}) {
  const [open, setOpen] = useState<'peek' | 'pinned' | null>(null)
  const anchor = useRef<HTMLElement>(null)
  const tip = useRef<HTMLSpanElement>(null)
  const id = useId()

  // The tip is a popover so the phone's scroll box can't clip it; it sits under
  // the clue's last line.
  useLayoutEffect(() => {
    const el = tip.current
    const lines = anchor.current?.getClientRects()
    if (!el || !lines?.length) return
    if (!open) return void (el.matches(':popover-open') && el.hidePopover())

    el.showPopover()
    const line = lines[lines.length - 1]
    const below = line.bottom + 8 + el.offsetHeight < innerHeight
    el.style.left = `${Math.max(8, Math.min(line.left, innerWidth - el.offsetWidth - 8))}px`
    el.style.top = `${below ? line.bottom + 8 : line.top - el.offsetHeight - 8}px`

    const close = () => setOpen(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => setOpen((o) => (o === 'pinned' ? null : 'pinned'))
  // Glue the number to the first character only: there's no break inside a word
  // anyway, and a long unbroken mark (an email address) can still wrap instead
  // of overflowing the phone.
  const [first = '', ...rest] = Array.from(children)

  return (
    // Not a <button>: buttons can't wrap mid-text, and long marks must.
    <mark
      ref={anchor}
      className="clue"
      role="button"
      tabIndex={0}
      aria-expanded={Boolean(open)}
      aria-describedby={id}
      onMouseEnter={() => setOpen((o) => o ?? 'peek')}
      onMouseLeave={() => setOpen((o) => (o === 'peek' ? null : o))}
      onFocus={() => setOpen((o) => o ?? 'peek')}
      onBlur={() => setOpen(null)}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggle()
        }
      }}
    >
      <span className="clue-head">
        <span className="clue-num" aria-hidden="true">
          {n}
        </span>
        {first}
      </span>
      {rest.join('')}
      <span className="sr-only">
        {' '}
        ({label} {n})
      </span>
      <span
        ref={tip}
        id={id}
        popover="manual"
        role="tooltip"
        className="clue-tip"
      >
        <strong>
          <span className="clue-num" aria-hidden="true">
            {n}
          </span>
          {indicator.title}
        </strong>
        {indicator.detail}
      </span>
    </mark>
  )
}

/** A link you can inspect but never follow: it is a button, not an anchor. */
export function LinkPreview({
  url,
  mark,
  clueLabel,
  onInspect,
}: {
  url: string
  mark?: number
  clueLabel: string
  onInspect: ThreadProps['onInspect']
}) {
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
          if (!open) onInspect('link', url)
          setOpen(!open)
        }}
      >
        {mark && (
          <span className="clue-num" aria-hidden="true">
            {mark}
          </span>
        )}
        {url}
        <span className="sr-only">
          {mark ? ` (${clueLabel} ${mark})` : ''}, inspect link
        </span>
      </button>
      {/* Springs open like a link preview sheet; inert while closed so it can't
          take focus. */}
      <m.div
        id={panel}
        className="sms-inspect-wrap"
        initial={false}
        inert={!open}
        aria-hidden={!open}
        animate={
          open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }
        }
        transition={open ? spring : { duration: 0.18, ease: 'easeOut' }}
      >
        <div className="sms-inspect">
          <p className="sms-inspect-note">
            <LockKeyhole size={13} aria-hidden="true" /> Practice link. It won't
            open.
          </p>
          <p className="sms-inspect-site">
            <Globe size={15} aria-hidden="true" />{' '}
            <span>
              Website: <strong>{siteOf(url)}</strong>
            </span>
          </p>
          <p className="sms-inspect-url">{url}</p>
        </div>
      </m.div>
    </>
  )
}
