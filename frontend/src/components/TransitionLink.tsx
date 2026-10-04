import type { MouseEvent } from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router-dom'
import { preloadPages } from '../lib/lazyPage'
import { confirmNavigation, navigationGuarded } from '../lib/navigationGuard'
import { withViewTransition, type NavDirection } from '../lib/viewTransition'

/**
 * A Link that animates the route change like a phone app (push forward, pop
 * back). During a live call it asks first.
 */
export function TransitionLink({
  direction = 'forward',
  onClick,
  ...props
}: LinkProps & { direction?: NavDirection }) {
  const navigate = useNavigate()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    // Leave modified clicks (new tab, etc.) and non-primary buttons to the
    // browser.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    event.preventDefault()
    // The target page's chunk must be loaded before the transition's
    // synchronous update, or it would animate to a loading screen. Already
    // loaded (the usual case, see App) this resolves at once; a failed load
    // still navigates.
    const go = () =>
      void preloadPages()
        .catch(() => {})
        .then(() =>
          withViewTransition(direction, () =>
            navigate(props.to, { state: props.state, replace: props.replace }),
          ),
        )
    if (!navigationGuarded()) return go()
    void confirmNavigation().then((leave) => {
      if (leave) go()
    })
  }

  return <Link {...props} onClick={handleClick} />
}
