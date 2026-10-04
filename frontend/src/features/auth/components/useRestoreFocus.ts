import { useEffect, useRef } from 'react'

// Pending auth calls disable the focused control, which drops keyboard focus to
// <body>. Call the returned function before the call starts; focus goes back
// to that control once `busy` clears, unless something else has taken focus.
export function useRestoreFocus(busy: boolean) {
  const target = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (busy) return
    if (
      target.current?.isConnected &&
      document.activeElement === document.body
    ) {
      target.current.focus()
    }
    target.current = null
  }, [busy])

  return () => {
    if (document.activeElement instanceof HTMLElement) {
      target.current = document.activeElement
    }
  }
}
