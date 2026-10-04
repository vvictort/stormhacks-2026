import type { InputHTMLAttributes, ReactNode } from 'react'

export interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  error?: string
  hint?: string
  trailingAction?: ReactNode
}

export function AuthField({ id, label, error, hint, trailingAction, className = '', ...inputProps }: AuthFieldProps) {
  // The error takes the hint's place, so describe the field by whichever is showing.
  const description = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          {...inputProps}
          id={id}
          className={`auth-input border-control bg-surface ${trailingAction ? 'has-action' : ''} ${className}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={description}
        />
        {trailingAction}
      </div>
      {/* A reserved message line: hint and error share it, so feedback never resizes the form. */}
      <div className="field-message">
        {hint && <p id={`${id}-hint`} className="field-hint text-muted-strong" data-hidden={error ? '' : undefined}>{hint}</p>}
        {error && <p key={error} id={`${id}-error`} className="field-error">{error}</p>}
      </div>
    </div>
  )
}
