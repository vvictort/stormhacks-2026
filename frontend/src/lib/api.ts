import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { createAuthenticatedApi } from './authenticatedRequest'

/**
 * Calls the backend as the signed-in user, sending their Firebase ID token (refreshed by the SDK when due).
 * A 401 means the backend no longer accepts the session, so we sign out and RequireAuth sends the user to /login.
 */
export const api = createAuthenticatedApi(auth, () => signOut(auth))
