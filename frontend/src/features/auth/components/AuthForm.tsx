import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { ArrowRight, Check, CircleAlert, LoaderCircle, LogOut } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { validateAuthForm, type AuthFieldName, type FieldErrors } from '../validation'
import { AuthCard } from './AuthCard'
import { AuthField } from './AuthField'
import { AuthNotice } from './AuthNotice'
import { PasswordInput } from './PasswordInput'
import { ResetPasswordDialog } from './ResetPasswordDialog'
import { SocialLoginButton } from './SocialLoginButton'
import { useRestoreFocus } from './useRestoreFocus'

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const isSignup = mode === 'signup'
  const { user, initializing, pending, error, passwordError, profileWarning, clearError, login, register, google, logout } = useAuth()
  const [values, setValues] = useState({ name: '', email: '', password: '', confirmPassword: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [resetOpen, setResetOpen] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const location = useLocation()

  useEffect(() => { clearError() }, [clearError, mode])

  useEffect(() => {
    if (passwordError) document.getElementById('auth-password')?.focus()
  }, [passwordError])

  const rememberFocus = useRestoreFocus(Boolean(pending))

  function change(field: AuthFieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, ...(field === 'password' ? { confirmPassword: undefined } : {}) }))
    clearError()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    clearError()
    const nextErrors = validateAuthForm(values, isSignup)
    // Commit the errors first so the focused field is already described by its message.
    flushSync(() => setErrors(nextErrors))
    const firstInvalidField = Object.keys(nextErrors)[0]
    if (firstInvalidField) {
      form.current?.querySelector<HTMLInputElement>(`[name="${firstInvalidField}"]`)?.focus()
      return
    }
    rememberFocus()
    const succeeded = isSignup
      ? await register(values.email.trim(), values.password, values.name.trim())
      : await login(values.email.trim(), values.password)
    if (succeeded) setValues({ name: '', email: '', password: '', confirmPassword: '' })
  }

  if (initializing) {
    return (
      <AuthCard title="Getting things ready" description="Checking your session…">
        <div className="session-loading" role="status"><LoaderCircle className="spinner text-primary" size={26} aria-hidden="true" /><span className="sr-only">Loading your session</span></div>
      </AuthCard>
    )
  }

  // Firebase signs in before the display-name update finishes. Keep the form
  // pending until the whole operation settles, including any profile warning.
  if (user && (!pending || pending === 'signout')) {
    return (
      <AuthCard title="You’re signed in" description={user.displayName ? `Welcome, ${user.displayName}. You’re in the right place.` : 'Welcome to Tellio. You’re in the right place.'}>
        <div className="signed-in-icon bg-success/15 text-success-strong"><Check size={30} aria-hidden="true" /></div>
        <p className="signed-in-message text-muted-strong">Your training experience is coming soon. Your account is ready when you are.</p>
        <p className="signed-in-email">{user.email}</p>
        {profileWarning && <AuthNotice tone="info">{profileWarning}</AuthNotice>}
        {error && <AuthNotice>{error}</AuthNotice>}
        <button type="button" className="social-button border-control" onClick={() => void logout()} disabled={Boolean(pending)} aria-busy={pending === 'signout'}>
          {pending === 'signout' ? <LoaderCircle size={18} className="spinner" aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}
          {pending === 'signout' ? 'Signing out…' : 'Sign out'}
        </button>
      </AuthCard>
    )
  }

  const disabled = Boolean(pending)
  const formPending = pending === mode
  const formError = resetOpen ? null : error
  return (
    <>
      <AuthCard title={isSignup ? 'Create your account' : 'Welcome back'} description={isSignup ? 'Get scam simulations matched to your level and see how you improve over time.' : 'Log in to pick up where you left off.'}>
        <form ref={form} className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={disabled}>
          <fieldset disabled={disabled} className="auth-fields">
            <legend className="sr-only">{isSignup ? 'Create your account' : 'Log in to your account'}</legend>
            {isSignup && <AuthField id="auth-name" name="name" label="Your name" autoComplete="name" required placeholder="Alex Taylor" value={values.name} error={errors.name} onChange={(event) => change('name', event.target.value)} />}
            <AuthField id="auth-email" name="email" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required placeholder="you@example.com" value={values.email} error={errors.email} onChange={(event) => change('email', event.target.value)} />
            <PasswordInput id="auth-password" name="password" label="Password" autoComplete={isSignup ? 'new-password' : 'current-password'} required placeholder={isSignup ? 'Create a strong password' : 'Enter your password'} value={values.password} error={errors.password || passwordError || undefined} hint={isSignup ? 'At least 8 characters. Make it something only you know.' : undefined} onChange={(event) => change('password', event.target.value)} />
            {isSignup && <PasswordInput id="auth-confirm-password" name="confirmPassword" label="Confirm password" autoComplete="new-password" required placeholder="Enter your password again" value={values.confirmPassword} error={errors.confirmPassword} onChange={(event) => change('confirmPassword', event.target.value)} />}
          </fieldset>
          {!isSignup && <div className="forgot-row"><button type="button" className="text-link" disabled={disabled} onClick={() => { clearError(); setResetOpen(true) }}>Forgot password?</button></div>}
          <button type="submit" className="primary-button bg-primary" disabled={disabled} aria-busy={formPending}>
            {formPending ? <><LoaderCircle size={18} className="spinner" aria-hidden="true" />{isSignup ? 'Creating your account…' : 'Logging in…'}</> : <>{isSignup ? 'Create account' : 'Log in'}<ArrowRight size={18} aria-hidden="true" /></>}
          </button>
        </form>
        {/* Form-level errors take the divider's place between the two buttons: next to whichever was pressed, and no extra height. */}
        <div className="form-feedback">
          <div className="auth-divider text-muted-strong" data-hidden={formError ? '' : undefined} aria-hidden={formError ? true : undefined}><span />or<span /></div>
          <div className="form-alert" role="alert">
            {formError && <p key={formError}><CircleAlert size={17} aria-hidden="true" />{formError}</p>}
          </div>
        </div>
        <SocialLoginButton signup={isSignup} pending={pending === 'google'} disabled={disabled} onClick={async () => {
          rememberFocus()
          if (await google()) setValues({ name: '', email: '', password: '', confirmPassword: '' })
        }} />
        <p className="auth-switch text-muted-strong">
          {isSignup ? 'Already have an account?' : 'New to Tellio?'}{' '}
          <Link className="text-link" to={isSignup ? '/login' : '/signup'} state={location.state} onClick={(event) => { if (pending) event.preventDefault() }} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>{isSignup ? 'Log in' : 'Create an account'}<ArrowRight size={14} aria-hidden="true" /></Link>
        </p>
      </AuthCard>
      {resetOpen && <ResetPasswordDialog initialEmail={values.email} onClose={() => { setResetOpen(false); clearError() }} />}
    </>
  )
}
