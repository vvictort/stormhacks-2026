import { Flag } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { splitIntoPhrases } from '../flagging.ts'
import type { Indicator } from '../scenarios.ts'
import { Marked } from './SmsThread.tsx'

interface FlaggableTextProps {
  text: string
  revealed: boolean
  indicators: Indicator[]
  clueLabel: string
  flaggedPhrases?: string[]
  onToggleFlag?: (phrase: string) => void
}

/**
 * Renders text that can be tapped to flag suspicious phrases before deciding.
 * Once revealed, it delegates to Marked to show verified clue indicators.
 */
export function FlaggableText({
  text,
  revealed,
  indicators,
  clueLabel,
  flaggedPhrases = [],
  onToggleFlag,
}: FlaggableTextProps) {
  if (revealed || !onToggleFlag) {
    return <Marked text={text} indicators={indicators} clueLabel={clueLabel} />
  }

  const phrases = splitIntoPhrases(text)

  return (
    <>
      {phrases.map((phrase, idx) => {
        const isFlagged = flaggedPhrases.includes(phrase)

        const handleKey = (e: KeyboardEvent) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            onToggleFlag(phrase)
          }
        }

        return (
          <span
            key={idx}
            role="button"
            tabIndex={0}
            aria-pressed={isFlagged}
            aria-label={`${phrase}${isFlagged ? ' (flagged suspicious)' : ''}`}
            className={`flaggable-phrase${isFlagged ? ' is-flagged' : ''}`}
            onClick={() => onToggleFlag(phrase)}
            onKeyDown={handleKey}
          >
            {isFlagged && <Flag size={11} className="flag-icon" aria-hidden="true" />}
            {phrase}{' '}
          </span>
        )
      })}
    </>
  )
}
