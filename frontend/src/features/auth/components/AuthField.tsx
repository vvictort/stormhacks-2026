import type { InputHTMLAttributes, ReactNode } from 'react'

export interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  error?: string
  hint?: string
  trailingAction?: ReactNode
  /** Shown at the right end of the label row, e.g. "Forgot password?". */
  labelAction?: ReactNode
  /**
   * Set false when something else (e.g. the password checklist) carries this
   * field's feedback.
   */
  messages?: boolean
}

export function AuthField({
  id,
  label,
  error,
  hint,
  trailingAction,
  labelAction,
  messages = true,
  className = '',
  ...inputProps
}: AuthFieldProps) {
  // The error takes the hint's place, so describe the field by whichever is
  // showing.
  let description = inputProps['aria-describedby']
  if (error) description = `${id}-error`
  else if (hint) description = `${id}-hint`

  return (
    <div className="form-field">
      <div className="field-label-row">
        <label htmlFor={id}>{label}</label>
        {labelAction}
      </div>
      <div className="input-wrap">
        <input
          {...inputProps}
          id={id}
          className={`auth-input border-control bg-surface ${trailingAction ? 'has-action' : ''} ${className}`}
          aria-invalid={error ? true : inputProps['aria-invalid']}
          aria-describedby={description}
        />
        {trailingAction}
      </div>
      {/* A reserved message line: hint and error share it, so feedback never
          resizes the form. */}
      {messages && (
        <div className="field-message">
          {hint && (
            <p
              id={`${id}-hint`}
              className="field-hint text-muted-strong"
              data-hidden={error ? '' : undefined}
            >
              {hint}
            </p>
          )}
          {error && (
            <p key={error} id={`${id}-error`} className="field-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
