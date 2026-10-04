export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordPolicyError'
  }
}

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof PasswordPolicyError) return error.message

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password don’t match. Try again.'
    case 'auth/email-already-in-use':
      return 'This email already has an account. Log in or reset your password.'
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Please choose a stronger password.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a little before trying again.'
    case 'auth/network-request-failed':
    case 'auth/timeout':
      return 'We couldn’t connect. Check your internet connection and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return 'Google sign-in was cancelled. You can try again when you’re ready.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google window. Allow popups.'
    case 'auth/web-storage-unsupported':
    case 'auth/operation-not-supported-in-this-environment':
      return 'Your browser is blocking sign-in. Allow cookies for this site.'
    case 'auth/account-exists-with-different-credential':
      return 'This email uses a different sign-in method. Try that one instead.'
    case 'auth/user-disabled':
      return 'This account has been disabled, so it can’t sign in right now.'
    case 'auth/operation-not-allowed':
    case 'auth/unauthorized-domain':
    case 'auth/configuration-not-found':
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
      return 'This sign-in method is temporarily unavailable. Please try again later.'
    default:
      return 'Something went wrong. Please try again in a moment.'
  }
}
