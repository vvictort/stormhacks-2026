export type AuthFieldName = 'name' | 'email' | 'password' | 'confirmPassword'
export type FieldErrors = Partial<Record<AuthFieldName, string>>

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
  else if (isSignup && values.password.length < 8) errors.password = 'Use at least 8 characters for your password.'
  if (isSignup) {
    if (!values.confirmPassword) errors.confirmPassword = 'Please confirm your password.'
    else if (values.password !== values.confirmPassword) errors.confirmPassword = 'Your passwords don’t match yet.'
  }
  return errors
}
