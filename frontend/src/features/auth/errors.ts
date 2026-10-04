export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordPolicyError'
  }
}

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof PasswordPolicyError) return error.message

  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password don’t match. Please check them and try again.'
    case 'auth/email-already-in-use':
      return 'There’s already an account with this email. Try logging in or resetting your password.'
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Please choose a stronger password that meets the account requirements.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a little before trying again.'
    case 'auth/network-request-failed':
      return 'We couldn’t connect. Check your internet connection and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled. You can try again when you’re ready.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow popups for this site and try again.'
    case 'auth/account-exists-with-different-credential':
      return 'This email uses another sign-in method. Try the method you used to create your account.'
    case 'auth/user-disabled':
      return 'This account is currently unavailable. Please contact your training administrator.'
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
