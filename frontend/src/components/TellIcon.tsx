import type { SVGProps } from 'react'

/** Tell, the mascot, shrunk to an icon: body, tail, eyes glancing aside and the beacon. Drop-in for a lucide icon. */
export function TellIcon({
  size = 24,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...props}>
      <g style={{ fill: 'var(--color-primary)' }}>
        <path d="M6.8 16.5Q7 20 4.6 22.2Q8.6 21.6 11.4 18.2Z" />
        <rect x="2.5" y="4.5" width="17.5" height="14.5" rx="6.8" />
      </g>
      <g style={{ fill: 'var(--color-surface)' }}>
        <ellipse cx="8.6" cy="11.4" rx="2.3" ry="2.7" />
        <ellipse cx="14" cy="11.4" rx="2.3" ry="2.7" />
      </g>
      <g fill="#2A211C">
        <circle cx="9.5" cy="11.8" r="1.25" />
        <circle cx="14.9" cy="11.8" r="1.25" />
      </g>
      <circle
        cx="20.3"
        cy="4"
        r="2.1"
        style={{ fill: 'var(--color-accent)' }}
      />
    </svg>
  )
}
