import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle, X } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { validateEmail } from '../validation'
import { AuthField } from './AuthField'
import { AuthNotice } from './AuthNotice'
import { useRestoreFocus } from './useRestoreFocus'

export function ResetPasswordDialog({
  initialEmail,
  onClose,
}: {
  initialEmail: string
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState(initialEmail)
  const [emailError, setEmailError] = useState<string>()
  const [sent, setSent] = useState(false)
  const { recoverPassword, pending, error, clearError } = useAuth()
  const rememberFocus = useRestoreFocus(Boolean(pending))

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    element?.showModal()
    element?.querySelector<HTMLInputElement>('#reset-email')?.focus()
    return () => {
      element?.close()
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    if (sent) {
      dialog.current
        ?.querySelector<HTMLButtonElement>('[data-reset-done]')
        ?.focus()
    }
  }, [sent])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const validationError = validateEmail(email)
    setEmailError(validationError)
    if (validationError) {
      document.getElementById('reset-email')?.focus()
      return
    }

    rememberFocus()
    if (await recoverPassword(email.trim())) setSent(true)
  }

  return (
    <dialog
      ref={dialog}
      className="reset-dialog border-border bg-surface"
      aria-labelledby="reset-heading"
      aria-describedby="reset-description"
      onCancel={onClose}
    >
      <button
        className="dialog-close text-muted-strong"
        type="button"
        onClick={onClose}
        aria-label="Close password reset"
      >
        <X size={20} aria-hidden="true" />
      </button>
      <h2 id="reset-heading">Forgot your password?</h2>
      <p id="reset-description" className="card-description text-muted-strong">
        Enter your email and we’ll send you a link to choose a new one.
      </p>
      {sent ? (
        <div className="reset-result">
          <AuthNotice tone="success">
            If an account uses this email, you’ll receive a password reset link.
            Check your inbox and spam folder.
          </AuthNotice>
          <button
            type="button"
            data-reset-done
            className="primary-button bg-primary"
            onClick={onClose}
          >
            Back to login <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="reset-form"
          aria-busy={pending === 'reset'}
        >
          <AuthField
            id="reset-email"
            name="email"
            label="Email address"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            error={emailError}
            disabled={Boolean(pending)}
            placeholder="you@example.com"
            onChange={(event) => {
              setEmail(event.target.value)
              setEmailError(undefined)
              clearError()
            }}
          />
          {error && <AuthNotice>{error}</AuthNotice>}
          <button
            type="submit"
            className="primary-button bg-primary"
            disabled={Boolean(pending)}
            aria-busy={pending === 'reset'}
          >
            {pending === 'reset' ? (
              <>
                <LoaderCircle
                  size={18}
                  className="spinner"
                  aria-hidden="true"
                />{' '}
                Sending reset link…
              </>
            ) : (
              <>
                Send reset link <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      )}
    </dialog>
  )
}
