import { auth } from '../firebase'
import { CommsError, createCommsClient } from './client'

async function firebaseIdToken(forceRefresh: boolean) {
  // currentUser is null until Firebase restores the persisted session.
  await auth.authStateReady()
  if (!auth.currentUser) throw new CommsError(401, 'not_signed_in')
  return auth.currentUser.getIdToken(forceRefresh)
}

export const comms = createCommsClient({
  baseUrl: import.meta.env.VITE_COMMS_BASE_URL ?? '/comms',
  getToken: firebaseIdToken,
})
