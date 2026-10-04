import { forwardRef, type CSSProperties, type ElementType, type HTMLAttributes } from 'react'

interface RevealTextProps extends HTMLAttributes<HTMLElement> {
  text: string
  as?: ElementType
  /** Delay before the first word, in ms. */
  delay?: number
}

/**
 * Text that arrives word by word, sharpening into place. Screen readers get the
 * plain sentence once; the animated words are hidden from them.
 */
export const RevealText = forwardRef<HTMLElement, RevealTextProps>(function RevealText({ text, as: Tag = 'span', delay = 0, className = '', style, ...rest }, ref) {
  const words = text.split(/\s+/).filter(Boolean)
  return (
    <Tag ref={ref} className={`reveal-text ${className}`} style={{ ...style, '--reveal-delay': `${delay}ms` } as CSSProperties} {...rest}>
      <span className="sr-only">{text}</span>
      {words.map((word, i) => (
        <span key={`${i}-${word}`} aria-hidden="true">
          <span className="reveal-word" style={{ '--w': i } as CSSProperties}>{word}</span>{i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </Tag>
  )
})
