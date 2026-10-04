import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { AuthField, type AuthFieldProps } from './AuthField'

export function PasswordInput(props: Omit<AuthFieldProps, 'type' | 'trailingAction'>) {
  const [visible, setVisible] = useState(false)

  return (
    <AuthField
      {...props}
      type={visible ? 'text' : 'password'}
      trailingAction={
        <button
          type="button"
          className="password-toggle text-muted-strong"
          onClick={() => setVisible(!visible)}
          disabled={props.disabled}
          aria-label={`${visible ? 'Hide' : 'Show'} ${props.label.toLowerCase()}`}
          aria-controls={props.id}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      }
    />
  )
}
