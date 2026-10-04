import { Link } from 'react-router-dom'

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="Tellio home">
      <span>tellio<span className="text-primary">.</span></span>
    </Link>
  )
}
