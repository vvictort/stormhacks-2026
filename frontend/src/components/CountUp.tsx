import { useEffect, useRef } from 'react'

/** A number that counts up to its value, like a phone's activity rings. */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = ref.current
    if (
      !node ||
      value === 0 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }
    const start = performance.now(),
      duration = 700
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / duration)
      node.textContent = String(Math.round(value * (1 - (1 - t) ** 4))) // ease-out-quart
      if (t < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [value])

  return (
    <>
      <span className="sr-only">{value}</span>
      <span ref={ref} aria-hidden="true" className="count-up">
        {value}
      </span>
    </>
  )
}
