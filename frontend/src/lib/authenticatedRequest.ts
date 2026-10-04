interface SessionUser {
  uid: string
  getIdToken: () => Promise<string>
}

interface Session {
  currentUser: SessionUser | null
  authStateReady: () => Promise<void>
}

/**
 * Keep every request and its response attached to the session that started it.
 */
export function createAuthenticatedApi(
  session: Session,
  signOut: () => Promise<void>,
  request: typeof fetch = fetch,
) {
  return async function api<T>(
    path: string,
    init: RequestInit = {},
    expectedUid?: string,
  ): Promise<T> {
    await session.authStateReady()
    const user = session.currentUser
    if (!user || (expectedUid !== undefined && user.uid !== expectedUid)) {
      throw new Error('Session changed')
    }

    function requireSameSession() {
      init.signal?.throwIfAborted()
      if (session.currentUser !== user) throw new Error('Session changed')
    }

    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`)
    if (init.body) headers.set('Content-Type', 'application/json')
    requireSameSession()
    const response = await request(`/api${path}`, { ...init, headers })
    requireSameSession()

    if (response.status === 401) await signOut()
    if (!response.ok) {
      throw new Error(
        `${init.method ?? 'GET'} /api${path} failed with ${response.status}`,
      )
    }
    const result = (await response.json()) as T
    requireSameSession()
    return result
  }
}
