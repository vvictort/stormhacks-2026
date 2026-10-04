import { signOut } from 'firebase/auth'
import { auth } from './firebase'

/**
 * Calls the backend as the signed-in user, sending their Firebase ID token (refreshed by the SDK when due).
 * A 401 means the backend no longer accepts the session, so we sign out and RequireAuth sends the user to /login.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  await auth.authStateReady()
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await user.getIdToken()}`)
  const response = await fetch(`/api${path}`, { ...init, headers })

  if (response.status === 401) await signOut(auth)
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} /api${path} failed with ${response.status}`)
  return response.json() as Promise<T>
}
