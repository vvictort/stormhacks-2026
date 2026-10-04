import { flushSync } from 'react-dom'

/** forward/back: page push and pop. swap: a card morphs in place. step-*: a wizard step inside a card. */
export type NavDirection = 'forward' | 'back' | 'swap' | 'step-forward' | 'step-back'

/**
 * Runs a DOM update inside a View Transition, iOS-style: `forward` pushes the new
 * screen in from the right, `back` pops it. CSS keys off `data-nav` on <html>.
 * Falls back to an instant update without the API or with reduced motion.
 */
export function withViewTransition(direction: NavDirection, update: () => void) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduce) return update()
  const root = document.documentElement
  root.dataset.nav = direction
  const transition = document.startViewTransition(() => flushSync(update))
  transition.finished.finally(() => { if (root.dataset.nav === direction) delete root.dataset.nav })
}

/** A tiny haptic tick where the platform supports it (Android browsers); a no-op elsewhere. */
export const haptic = (ms = 10) => { try { navigator.vibrate?.(ms) } catch { /* unsupported */ } }
