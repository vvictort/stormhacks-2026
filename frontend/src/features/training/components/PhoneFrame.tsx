import {
  BatteryMedium,
  ChevronLeft,
  Signal,
  UserRound,
  Wifi,
} from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Neutral handset shell shared by every channel. The status bar is decoration,
 * hidden from assistive tech.
 */
export function PhoneFrame({
  time,
  children,
}: {
  time: string
  children: ReactNode
}) {
  return (
    <div className="phone">
      <div className="phone-screen">
        <div className="phone-status" aria-hidden="true">
          <span>{time.replace(/\s?[AP]M$/, '')}</span>
          <span className="phone-camera" />
          <span className="phone-status-icons">
            <Signal size={13} />
            <Wifi size={13} />
            <BatteryMedium size={16} />
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}

/** In-app title bar: who the conversation, inbox or call is with. */
export function AppHeader({
  title,
  subtitle,
  label,
}: {
  title: string
  subtitle: string
  label: string
}) {
  return (
    <div className="phone-app-header">
      <ChevronLeft size={22} aria-hidden="true" className="phone-app-back" />
      <span className="phone-avatar" aria-hidden="true">
        <UserRound size={20} />
      </span>
      <div className="phone-app-title">
        <h2>
          <span className="sr-only">{label} </span>
          {title}
        </h2>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}
