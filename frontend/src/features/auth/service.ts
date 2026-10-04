import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  validatePassword,
  type User,
} from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { PasswordPolicyError } from './errors'

export const signIn = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password)

export async function signUp(email: string, password: string, name: string) {
  const policy = await validatePassword(auth, password)

  if (!policy.isValid) {
    const requirements: string[] = []
    const strength = policy.passwordPolicy.customStrengthOptions
    if (policy.meetsMinPasswordLength === false) {
      requirements.push(`at least ${strength.minPasswordLength} characters`)
    }
    if (policy.meetsMaxPasswordLength === false) {
      requirements.push(`no more than ${strength.maxPasswordLength} characters`)
    }
    if (policy.containsLowercaseLetter === false) {
      requirements.push('a lowercase letter')
    }
    if (policy.containsUppercaseLetter === false) {
      requirements.push('an uppercase letter')
    }
    if (policy.containsNumericCharacter === false) requirements.push('a number')
    if (policy.containsNonAlphanumericCharacter === false) {
      requirements.push('a symbol')
    }
    // Short enough for the form's error row (no symbol list); "a, b and c" reads better than a comma dump.
    const list =
      requirements.length > 1
        ? `${requirements.slice(0, -1).join(', ')} and ${requirements.at(-1)}`
        : requirements[0]
    throw new PasswordPolicyError(
      `Your password needs ${list ?? 'to meet the account requirements'}.`,
    )
  }

  const credential = await createUserWithEmailAndPassword(auth, email, password)
  let profileWarning: string | null = null

  // The account already exists at this point. A profile failure must not invite
  // another account-creation attempt.
  try {
    await updateProfile(credential.user, { displayName: name })
  } catch {
    profileWarning =
      'Your account is ready, but we couldn’t save your name. You can add it later.'
  }

  return { credential, profileWarning }
}

export const signInWithGoogle = () => {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return signInWithPopup(auth, provider)
}

export async function resetPassword(email: string) {
  try {
    await sendPasswordResetEmail(auth, email)
  } catch (error) {
    // Give the same response for unknown accounts, even if enumeration
    // protection has not been enabled in the Firebase project.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'auth/user-not-found'
    ) {
      return
    }
    throw error
  }
}

export const signOut = () => firebaseSignOut(auth)

// The live session, which an operation's own credential can lag behind (e.g. a sign-out in another tab).
export const currentUser = () => auth.currentUser

export const observeAuthState = (
  onChange: (user: User | null) => void,
  onError?: (error: Error) => void,
) => onAuthStateChanged(auth, onChange, onError)
