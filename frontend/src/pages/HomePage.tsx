import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Me {
  uid: string
  email: string | null
  name: string | null
}

// Placeholder: the training home is built in features/training.
export function HomePage() {
  const [me, setMe] = useState<Me | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    api<Me>('/users/me').then(setMe, () => setFailed(true))
  }, [])

  return (
    <main>
      <h1>Training home</h1>
      <p role="status">{failed ? 'We couldn’t reach the server.' : me ? `Signed in as ${me.name ?? me.email}` : 'Loading…'}</p>
    </main>
  )
}
