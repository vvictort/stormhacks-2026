export type AuthFieldName = 'name' | 'email' | 'password' | 'confirmPassword'
export type FieldErrors = Partial<Record<AuthFieldName, string>>

export const MIN_PASSWORD_LENGTH = 8

/** The signup password rules, shown as a live checklist and enforced by validateAuthForm. */
export function passwordChecks(password: string, confirmPassword: string) {
  return [
    { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: password.length >= MIN_PASSWORD_LENGTH },
    { id: 'match', label: 'Passwords match', met: confirmPassword.length > 0 && password === confirmPassword },
  ]
}

export function validateEmail(email: string): string | undefined {
  if (!email.trim()) return 'Please enter your email address.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Please enter a valid email address.'
}

export function validateAuthForm(values: Record<AuthFieldName, string>, isSignup: boolean): FieldErrors {
  const errors: FieldErrors = {}
  if (isSignup && !values.name.trim()) errors.name = 'Please enter your name.'
  const emailError = validateEmail(values.email)
  if (emailError) errors.email = emailError
  if (!values.password) errors.password = 'Please enter your password.'
  else if (isSignup && values.password.length < MIN_PASSWORD_LENGTH) errors.password = 'Use at least 8 characters.'
  if (isSignup) {
    if (!values.confirmPassword) errors.confirmPassword = 'Please confirm your password.'
    else if (values.password !== values.confirmPassword) errors.confirmPassword = 'Your passwords don’t match yet.'
  }
  return errors
}
