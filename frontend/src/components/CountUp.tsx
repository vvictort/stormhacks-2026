import { useEffect, useRef } from 'react'

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

    const start = performance.now()
    const duration = 700
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / duration)
      // ease-out-quart
      node.textContent = String(Math.round(value * (1 - (1 - t) ** 4)))
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
