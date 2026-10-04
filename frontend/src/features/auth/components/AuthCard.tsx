import { useEffect, useRef, type ReactNode } from 'react'
import { RevealText } from '../../../components/RevealText'

interface AuthCardProps {
  title: string
  description: ReactNode
  children: ReactNode
}

export function AuthCard({ title, description, children }: AuthCardProps) {
  const heading = useRef<HTMLElement>(null)

  useEffect(() => {
    document.title = `${title} · Tellio`
    heading.current?.focus({ preventScroll: true })
  }, [title])

  return (
    <section className="auth-card border-border bg-surface" aria-labelledby="auth-heading">
      <div className="card-heading">
        <RevealText as="h1" id="auth-heading" ref={heading} tabIndex={-1} text={title} delay={120} />
        <p className="card-description text-muted-strong">{description}</p>
      </div>
      {children}
    </section>
  )
}
