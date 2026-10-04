import { useEffect, useRef, type ReactNode } from 'react'
import { Mascot, type MascotMood } from '../../../components/Mascot'
import { RevealText } from '../../../components/RevealText'

interface AuthCardProps {
  title: string
  description: ReactNode
  mood?: MascotMood
  children: ReactNode
}

export function AuthCard({
  title,
  description,
  mood,
  children,
}: AuthCardProps) {
  const heading = useRef<HTMLElement>(null)

  useEffect(() => {
    document.title = `${title} · Tellio`
    heading.current?.focus({ preventScroll: true })
  }, [title])

  return (
    <section className="auth-card" aria-labelledby="auth-heading">
      <div className="card-heading">
        <div>
          <RevealText
            as="h1"
            id="auth-heading"
            ref={heading}
            tabIndex={-1}
            text={title}
            delay={120}
          />
          <p className="card-description text-muted-strong">{description}</p>
        </div>
        {/* Decorative: on wide screens Tell sits in the margin with a hand-drawn note; on phones, beside the heading. */}
        <div className="auth-mascot" aria-hidden="true">
          <Mascot mood={mood} />
          <p className="auth-note">
            <svg width="34" height="30" viewBox="0 0 34 30" fill="none">
              <path d="M30 26C24 25 13 22 8 6M3 11l5-6 5 5" />
            </svg>
            practice makes suspicious
          </p>
        </div>
      </div>
      {children}
    </section>
  )
}
