import { LoaderCircle, Mail } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../../lib/api'
import { preloadPages } from '../../../lib/lazyPage'
import { withViewTransition } from '../../../lib/viewTransition'
import { generateScenario } from '../generate'

/** Writes a practice email for this user, then opens it like any other scenario. */
export function GenerateEmailButton() {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function start() {
    setPending(true)
    setError(undefined)
    try {
      const scenario = await generateScenario(api)
      await preloadPages().catch(() => {})
      withViewTransition('forward', () => navigate(`/train/${scenario.id}`))
    } catch (failure) {
      setError((failure as Error).message)
      setPending(false)
    }
  }

  return (
    <div className="home-generate">
      <button type="button" className="train-ghost" onClick={start} disabled={pending} aria-busy={pending}>
        {pending ? <LoaderCircle size={17} className="spinner" aria-hidden="true" /> : <Mail size={17} aria-hidden="true" />}
        {pending ? 'Writing your email…' : 'Practise with an email made for you'}
      </button>
      {error && <p className="home-generate-error" role="alert">{error}</p>}
    </div>
  )
}
