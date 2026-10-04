import type { InputHTMLAttributes, ReactNode } from 'react'

export interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  error?: string
  hint?: string
  trailingAction?: ReactNode
}

export function AuthField({ id, label, error, hint, trailingAction, className = '', ...inputProps }: AuthFieldProps) {
  const description = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined

  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          {...inputProps}
          id={id}
          className={`auth-input border-border bg-surface ${trailingAction ? 'has-action' : ''} ${className}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={description}
        />
        {trailingAction}
      </div>
      {hint && <p id={`${id}-hint`} className="field-hint text-muted-strong">{hint}</p>}
      {error && <p id={`${id}-error`} className="field-error" role="alert">{error}</p>}
    </div>
  )
}
