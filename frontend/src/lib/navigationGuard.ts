// Lets a live call stop the user from leaving by accident. TransitionLink,
// Brand and Sign out ask the active guard first; the call screen registers one
// while it is connecting or in a call.
// ponytail: one module-level guard, since only one call can run at a time; a context if that ever changes.

type Guard = () => Promise<boolean>
let current: Guard | null = null

/** Registers the guard; returns the unregister function. */
export function setNavigationGuard(guard: Guard) {
  current = guard
  return () => {
    if (current === guard) current = null
  }
}

export const navigationGuarded = () => current !== null

/**
 * Resolves true when it's fine to navigate (no guard, or the user chose to
 * leave and the call was hung up).
 */
export const confirmNavigation = () =>
  current ? current() : Promise.resolve(true)

export type LeaveTrigger = 'link' | 'sign_out' | 'back_button' | 'unload'

/** Phases where leaving would cut off a live call. */
export const guardsNavigation = (phase: string) =>
  phase === 'connecting' || phase === 'in_call'

/**
 * What to do when the user tries to leave. `unload` can only get the browser's
 * own prompt; the back button has already moved the history entry, so staying
 * means putting it back.
 */
export function leaveDecision(
  phase: string,
  trigger: LeaveTrigger,
  choice?: 'stay' | 'leave',
) {
  if (!guardsNavigation(phase)) return 'allow'
  if (trigger === 'unload') return 'browser_prompt'
  if (!choice) return 'confirm'
  if (choice === 'stay') {
    return trigger === 'back_button' ? 'restore_entry' : 'stay'
  }
  return trigger === 'back_button' ? 'hang_up_then_back' : 'hang_up_then_go'
}
