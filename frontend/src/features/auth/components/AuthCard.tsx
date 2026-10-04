import { useEffect, useRef, type ReactNode } from 'react'

interface AuthCardProps {
  title: string
  description: string
  children: ReactNode
}

export function AuthCard({ title, description, children }: AuthCardProps) {
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    document.title = `${title} · Tellio`
    heading.current?.focus({ preventScroll: true })
  }, [title])

  return (
    <section className="auth-card border-border bg-surface" aria-labelledby="auth-heading">
      <div className="card-heading">
        <h1 id="auth-heading" ref={heading} tabIndex={-1}>{title}</h1>
        <p className="card-description text-muted-strong">{description}</p>
      </div>
      {children}
    </section>
  )
}
