import { Link } from 'react-router-dom'

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="Tellio home">
      <span className="brand-mark bg-primary" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M10 7v13c0 4 3 6 7 5l4-1M5 12h21M18 7v10" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          <path d="m22 5 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" fill="currentColor" />
        </svg>
      </span>
      <span>tellio<span className="text-primary">.</span></span>
    </Link>
  )
}
