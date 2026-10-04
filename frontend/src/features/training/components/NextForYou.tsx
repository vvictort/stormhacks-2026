import { ArrowRight, LoaderCircle, Phone, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TransitionLink } from '../../../components/TransitionLink'
import { api } from '../../../lib/api'
import { preloadPages } from '../../../lib/lazyPage'
import { withViewTransition } from '../../../lib/viewTransition'
import { insightSourceLabel } from '../../insights/scamProfile'
import { learned, levelName, nextForYou, type Adaptive } from '../adaptive'
import { requestPersonalisedCall } from '../call/requestCall'
import { generateScenario } from '../generate'
import { scenarios, type Difficulty } from '../scenarios'
import type { Learning } from '../useLearning'
import './nextForYou.css'

/** A built-in scenario of that channel near that level: the calm way out when generating fails. */
const builtIn = (type: 'email' | 'call', difficulty: Difficulty) =>
  scenarios.find((s) => s.type === type && s.difficulty === difficulty) ?? scenarios.find((s) => s.type === type)!

/** Generates an email (and optionally a call) for this user, then opens it. On failure, offers a built-in one instead. */
export function MadeForYouActions({ difficulty, label, withCall = false }: { difficulty: Difficulty; label: string; withCall?: boolean }) {
  const navigate = useNavigate()
  const [pending, setPending] = useState<'email' | 'call' | null>(null)
  const [failed, setFailed] = useState<{ message: string; type: 'email' | 'call' }>()

  async function start(type: 'email' | 'call') {
    setPending(type)
    setFailed(undefined)
    try {
      const id = type === 'email' ? (await generateScenario(api)).id : await requestPersonalisedCall()
      await preloadPages().catch(() => {})
      withViewTransition('forward', () => navigate(`/train/${id}`))
    } catch (error) {
      setFailed({ type, message: type === 'email' ? (error as Error).message : "We couldn't set up a call made for you just now." })
      setPending(null)
    }
  }

  const fallback = failed && builtIn(failed.type, difficulty)
  return (
    <div className="made-for-you">
      <div className="made-for-you-buttons">
        <button type="button" className="train-primary" onClick={() => void start('email')} disabled={pending !== null} aria-busy={pending === 'email'}>
          {pending === 'email' ? <><LoaderCircle size={17} className="spinner" aria-hidden="true" />Writing your email…</> : <>{label}<ArrowRight size={17} aria-hidden="true" /></>}
        </button>
        {withCall && (
          <button type="button" className="train-ghost" onClick={() => void start('call')} disabled={pending !== null} aria-busy={pending === 'call'}>
            {pending === 'call' ? <LoaderCircle size={17} className="spinner" aria-hidden="true" /> : <Phone size={16} aria-hidden="true" />}
            {pending === 'call' ? 'Setting up your call…' : 'Take a call made for you'}
          </button>
        )}
      </div>
      {failed && fallback && (
        <p className="made-for-you-error" role="alert">
          {failed.message}{' '}
          <TransitionLink className="text-link" to={`/train/${fallback.id}`}>Try “{fallback.title}” instead<ArrowRight size={14} aria-hidden="true" /></TransitionLink>
        </p>
      )}
    </div>
  )
}

/** Home's primary path: what Tellio trains next, why, and at what difficulty. */
export function NextForYou({ adaptive, localLevel, loading }: { adaptive: Adaptive | null; localLevel: Difficulty; loading: boolean }) {
  const next = nextForYou(adaptive, localLevel)
  return (
    <section className="next-for-you" aria-labelledby="next-title" aria-busy={loading}>
      <h2 id="next-title"><Sparkles size={14} aria-hidden="true" />Next for you</h2>
      {loading
        ? <div className="scam-profile-skeleton" aria-hidden="true"><span /><span /><span /></div>
        : (
          <>
            <p className="next-title">{next.title}</p>
            <p>{next.reason}</p>
            <p className="next-level">Difficulty: <strong>{levelName(next.difficulty)}</strong></p>
          </>
        )}
      <MadeForYouActions difficulty={next.difficulty} label="Start it" withCall />
    </section>
  )
}

/** After a debrief: what changed in Tellio's picture of this user, compared with before the run, and the next step. */
export function LearnedPanel({ learning, attemptId }: { learning: Learning; attemptId: string }) {
  if (learning.status === 'loading' || learning.status === 'off') return null
  const view = learning.status === 'ready' ? learned(learning.before, learning.after, attemptId) : null
  const difficulty = view?.next.difficulty ?? learning.before.adaptive?.difficulty ?? 'easy'

  return (
    <section className="learned" aria-labelledby="learned-title" aria-live="polite" aria-busy={learning.status === 'waiting'}>
      <h3 id="learned-title"><Sparkles size={14} aria-hidden="true" />What Tellio learned</h3>
      {learning.status === 'waiting'
        ? <p className="learned-wait"><LoaderCircle size={16} className="spinner" aria-hidden="true" />Updating your profile…</p>
        : !view
          ? <p className="learned-wait">Couldn't update your profile. It'll catch up next time.</p>
          : (
            <>
              <ul className="learned-list">{view.lines.slice(0, 2).map((line) => <li key={line}>{line}</li>)}</ul>
              {view.insight && (
                <figure className="learned-insight">
                  <blockquote>{view.insight.pattern}</blockquote>
                  <figcaption>{insightSourceLabel(view.insight.source)}</figcaption>
                </figure>
              )}
              <p className="learned-next">Next up: <strong>{view.next.title.replace(/, made for you$/, '')}</strong> · {levelName(view.next.difficulty)}</p>
            </>
          )}
      {learning.status !== 'waiting' && <MadeForYouActions difficulty={difficulty} label="Next scenario made for you" />}
    </section>
  )
}
