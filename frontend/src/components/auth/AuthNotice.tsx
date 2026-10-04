import { CircleAlert, CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'

export function AuthNotice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' | 'info' }) {
  return (
    <div className={`auth-notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? <CircleCheck size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
      <p>{children}</p>
    </div>
  )
}
