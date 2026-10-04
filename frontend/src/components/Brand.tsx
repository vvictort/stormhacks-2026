import { TransitionLink } from './TransitionLink'

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <TransitionLink
      direction="back"
      to={to}
      className="brand"
      aria-label="chatisthisreal home"
    >
      <span>
        chatisthisreal<span className="text-primary">.</span>
      </span>
    </TransitionLink>
  )
}
