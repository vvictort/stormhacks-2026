import type { MouseEvent } from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router-dom'
import { withViewTransition, type NavDirection } from '../lib/viewTransition'

/** A Link that animates the route change like a phone app (push forward, pop back). */
export function TransitionLink({ direction = 'forward', onClick, ...props }: LinkProps & { direction?: NavDirection }) {
  const navigate = useNavigate()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    // Leave modified clicks (new tab, etc.) and non-primary buttons to the browser.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    withViewTransition(direction, () => navigate(props.to, { state: props.state, replace: props.replace }))
  }

  return <Link {...props} onClick={handleClick} />
}
