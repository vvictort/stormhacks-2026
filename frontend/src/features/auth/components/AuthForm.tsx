import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { ArrowRight, Check, CircleAlert, LoaderCircle, LogOut } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { TransitionLink } from '../../../components/TransitionLink'
import { withViewTransition } from '../../../lib/viewTransition'
import { useAuth } from '../AuthContext'
import { passwordChecks, validateAuthForm, type AuthFieldName, type FieldErrors } from '../validation'
import { AuthCard } from './AuthCard'
import { AuthField } from './AuthField'
import { AuthNotice } from './AuthNotice'
import { PasswordChecklist } from './PasswordChecklist'
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
  // Signup is two short steps: who you are, then a password with a live checklist.
  const [step, setStep] = useState<'details' | 'password'>('details')
  const [triedPassword, setTriedPassword] = useState(false)
  const [stepMoved, setStepMoved] = useState(false)
  const onPasswordStep = isSignup && step === 'password'
  const form = useRef<HTMLFormElement>(null)
  const location = useLocation()

  useEffect(() => { clearError() }, [clearError, mode])

  useEffect(() => {
    if (passwordError) document.getElementById('auth-password')?.focus()
  }, [passwordError])

  const rememberFocus = useRestoreFocus(Boolean(pending))

  // Moving between signup steps puts focus on the first field of the new step.
  useEffect(() => {
    if (!stepMoved) return
    document.getElementById(step === 'password' ? 'auth-password' : 'auth-email')?.focus()
  }, [step, stepMoved])

  function goToStep(next: 'details' | 'password') {
    clearError()
    // The fields push sideways inside the card, like a wizard on a phone.
    withViewTransition(next === 'password' ? 'step-forward' : 'step-back', () => {
      setStepMoved(true)
      setStep(next)
    })
  }

  function change(field: AuthFieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, ...(field === 'password' ? { confirmPassword: undefined } : {}) }))
    clearError()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    clearError()
    // Each signup step only checks its own fields.
    const stepFields: AuthFieldName[] | null = !isSignup ? null : step === 'details' ? ['name', 'email'] : ['password', 'confirmPassword']
    const allErrors = validateAuthForm(values, isSignup)
    const nextErrors: FieldErrors = stepFields ? Object.fromEntries(Object.entries(allErrors).filter(([field]) => stepFields.includes(field as AuthFieldName))) : allErrors
    if (onPasswordStep) setTriedPassword(true)
    // Commit the errors first so the focused field is already described by its message.
    flushSync(() => setErrors(nextErrors))
    const firstInvalidField = Object.keys(nextErrors)[0]
    if (firstInvalidField) {
      form.current?.querySelector<HTMLInputElement>(`[name="${firstInvalidField}"]`)?.focus()
      return
    }
    if (isSignup && step === 'details') return goToStep('password')
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
      <AuthCard title="You’re signed in" mood="happy" description={user.displayName ? `Welcome, ${user.displayName}. You’re in the right place.` : 'Welcome to Tellio. You’re in the right place.'}>
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
  // Firebase's own password policy (stricter projects only) reports here too.
  const formError = resetOpen ? null : error ?? passwordError
  // After a submit attempt, unmet rules stay marked until they are met.
  const [lengthCheck, matchCheck] = passwordChecks(values.password, values.confirmPassword)
  // Tell reacts to the form: thinking while a request runs, a sideways look when something needs fixing.
  const mood = formError || Object.values(errors).some(Boolean) ? 'suspicious' : pending ? 'curious' : 'idle'
  return (
    <>
      <AuthCard
        title={isSignup ? 'Create your account' : 'Welcome back'}
        mood={mood}
        description={!isSignup ? 'Log in to pick up where you left off.'
          : !onPasswordStep ? 'Scam practice matched to your level, at your own pace.'
          : <>Signing up as <strong className="card-email">{values.email.trim()}</strong>. <button type="button" className="text-link inline-link" disabled={disabled} onClick={() => goToStep('details')}>Change</button></>}
      >
        <form ref={form} className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={disabled}>
          <fieldset disabled={disabled} className="auth-fields">
            <legend className="sr-only">{isSignup ? 'Create your account' : 'Log in to your account'}</legend>
            {!onPasswordStep ? (
              <div key="details" className={stepMoved ? 'form-step' : 'form-step-static'}>
                {isSignup && <AuthField id="auth-name" name="name" label="Your name" autoComplete="name" required placeholder="Alex Taylor" value={values.name} error={errors.name} onChange={(event) => change('name', event.target.value)} />}
                <AuthField id="auth-email" name="email" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required placeholder="you@example.com" value={values.email} error={errors.email} onChange={(event) => change('email', event.target.value)} />
                {!isSignup && <PasswordInput id="auth-password" name="password" label="Password" labelAction={<button type="button" className="text-link field-label-action" disabled={disabled} onClick={() => { clearError(); setResetOpen(true) }}>Forgot password?</button>} autoComplete="current-password" required placeholder="Enter your password" value={values.password} error={errors.password} aria-invalid={passwordError ? true : undefined} onChange={(event) => change('password', event.target.value)} />}
              </div>
            ) : (
              <div key="password" className="form-step">
                {/* Lets password managers save the new password against this email. */}
                <input type="email" name="username" autoComplete="username" value={values.email.trim()} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
                <PasswordInput id="auth-password" name="password" label="Password" autoComplete="new-password" required placeholder="Create a strong password" value={values.password} messages={false} aria-describedby="password-checklist" aria-invalid={(triedPassword && !lengthCheck.met) || passwordError ? true : undefined} onChange={(event) => change('password', event.target.value)} />
                <PasswordInput id="auth-confirm-password" name="confirmPassword" label="Confirm password" autoComplete="new-password" required placeholder="Enter your password again" value={values.confirmPassword} messages={false} aria-describedby="password-checklist" aria-invalid={triedPassword && !matchCheck.met ? true : undefined} onChange={(event) => change('confirmPassword', event.target.value)} />
                <PasswordChecklist id="password-checklist" password={values.password} confirmPassword={values.confirmPassword} showErrors={triedPassword} />
              </div>
            )}
          </fieldset>
          <button type="submit" className="primary-button bg-primary" disabled={disabled} aria-busy={formPending}>
            {formPending ? <><LoaderCircle size={18} className="spinner" aria-hidden="true" />{isSignup ? 'Creating your account…' : 'Logging in…'}</> : <>{!isSignup ? 'Log in' : onPasswordStep ? 'Create account' : 'Continue'}<ArrowRight size={18} aria-hidden="true" /></>}
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
          <TransitionLink direction="swap" className="text-link" to={isSignup ? '/login' : '/signup'} state={location.state} onClick={(event) => { if (pending) event.preventDefault() }} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>{isSignup ? 'Log in' : 'Create an account'}<ArrowRight size={14} aria-hidden="true" /></TransitionLink>
        </p>
      </AuthCard>
      {resetOpen && <ResetPasswordDialog initialEmail={values.email} onClose={() => { setResetOpen(false); clearError() }} />}
    </>
  )
}
