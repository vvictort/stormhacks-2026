import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TransitionLink } from '../../../components/TransitionLink'
import { api } from '../../../lib/api'
import { preloadPages } from '../../../lib/lazyPage'
import { withViewTransition } from '../../../lib/viewTransition'
import { useAuth } from '../../auth/AuthContext'
import { insightSourceLabel } from '../../insights/scamProfile'
import { learned, levelName, nextForYou, type Adaptive } from '../adaptive'
import { requestPersonalisedCall } from '../call/requestCall'
import { generateScenario } from '../generate'
import { recommend, type Progress } from '../progress'
import { scenarios, type Difficulty } from '../scenarios'
import type { Learning } from '../useLearning'
import './nextForYou.css'

/**
 * A built-in scenario of that channel near that level: the calm way out when
 * generating fails.
 */
const builtIn = (type: 'email' | 'call', difficulty: Difficulty) =>
  scenarios.find((s) => s.type === type && s.difficulty === difficulty) ??
  scenarios.find((s) => s.type === type)!

/**
 * Generates an email (and optionally a call) for this user, then opens it. On
 * failure, offers a built-in one instead.
 */
export function MadeForYouActions({
  difficulty,
  label,
  withCall = false,
  variant = 'buttons',
  progress = {},
}: {
  difficulty: Difficulty
  label: string
  withCall?: boolean
  variant?: 'buttons' | 'picker'
  progress?: Progress
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const request = useRef<AbortController | null>(null)
  const [pending, setPending] = useState<'email' | 'call' | null>(null)
  const [failed, setFailed] = useState<{
    message: string
    type: 'email' | 'call'
  }>()
  useEffect(() => () => request.current?.abort(), [user?.uid])

  async function start(type: 'email' | 'call') {
    if (pending || !user) return
    const controller = new AbortController()
    request.current = controller
    setPending(type)
    setFailed(undefined)
    try {
      const id =
        type === 'email'
          ? (
              await generateScenario((path, init) =>
                api(path, { ...init, signal: controller.signal }, user.uid),
              )
            ).id
          : await requestPersonalisedCall(controller.signal, user.uid)
      await preloadPages().catch(() => {})
      if (controller.signal.aborted) return
      withViewTransition('forward', () => navigate(`/train/${id}`))
    } catch (error) {
      if (controller.signal.aborted) return
      setFailed({
        type,
        message:
          type === 'email'
            ? (error as Error).message
            : "We couldn't set up a call made for you just now.",
      })
      setPending(null)
    }
  }

  const fallback = failed && builtIn(failed.type, difficulty)
  const texts = scenarios.filter((s) => s.type === 'sms')
  const text = recommend(progress, undefined, texts) ?? texts[0]

  return (
    <div
      className={`made-for-you${variant === 'picker' ? ' practice-picker' : ''}`}
    >
      {variant === 'picker' ? (
        <div className="practice-picker-grid">
          <TransitionLink className="practice-option" to={`/train/${text.id}`}>
            <span className="practice-option-mode">Read &amp; decide</span>
            <strong>Text message</strong>
            <span className="practice-option-description">
              Check the details in a message on your phone.
            </span>
            <span className="practice-option-action">
              Start a text
              <ArrowRight size={16} aria-hidden="true" />
            </span>
          </TransitionLink>
          <button
            type="button"
            className="practice-option"
            onClick={() => void start('email')}
            disabled={pending !== null}
            aria-busy={pending === 'email'}
          >
            <span className="practice-option-mode">Read &amp; decide</span>
            <strong>Email</strong>
            <span className="practice-option-description">
              Investigate a fresh email made for your level.
            </span>
            <span className="practice-option-action">
              {pending === 'email' ? (
                <>
                  <LoaderCircle
                    size={16}
                    className="spinner"
                    aria-hidden="true"
                  />
                  Writing your email…
                </>
              ) : (
                <>
                  Start an email
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </span>
          </button>
          <button
            type="button"
            className="practice-option"
            onClick={() => void start('call')}
            disabled={pending !== null}
            aria-busy={pending === 'call'}
          >
            <span className="practice-option-mode">Listen &amp; respond</span>
            <strong>Phone call</strong>
            <span className="practice-option-description">
              Handle a caller and practise what to say.
            </span>
            <span className="practice-option-action">
              {pending === 'call' ? (
                <>
                  <LoaderCircle
                    size={16}
                    className="spinner"
                    aria-hidden="true"
                  />
                  Preparing your call…
                </>
              ) : (
                <>
                  Start a call
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </span>
          </button>
        </div>
      ) : (
        <div className="made-for-you-buttons">
          <button
            type="button"
            className="train-primary"
            onClick={() => void start('email')}
            disabled={pending !== null}
            aria-busy={pending === 'email'}
          >
            {pending === 'email' ? (
              <>
                <LoaderCircle
                  size={17}
                  className="spinner"
                  aria-hidden="true"
                />
                Writing your email…
              </>
            ) : (
              <>
                {label}
                <ArrowRight size={17} aria-hidden="true" />
              </>
            )}
          </button>
          {withCall && (
            <button
              type="button"
              className="train-ghost"
              onClick={() => void start('call')}
              disabled={pending !== null}
              aria-busy={pending === 'call'}
            >
              {pending === 'call' && (
                <LoaderCircle
                  size={17}
                  className="spinner"
                  aria-hidden="true"
                />
              )}
              {pending === 'call' ? 'Setting up your call…' : 'Practise a call'}
            </button>
          )}
        </div>
      )}
      <p className="made-for-you-status" role="status">
        {pending
          ? pending === 'email'
            ? 'Writing your practice email…'
            : 'Preparing your practice call…'
          : ''}
      </p>
      {failed && fallback && (
        <p className="made-for-you-error" role="alert">
          {failed.message}{' '}
          <TransitionLink className="text-link" to={`/train/${fallback.id}`}>
            Try “{fallback.title}” instead
            <ArrowRight size={14} aria-hidden="true" />
          </TransitionLink>
        </p>
      )}
    </div>
  )
}

/**
 * Home's primary path: what Tellio trains next, why, and at what difficulty.
 */
export function NextForYou({
  adaptive,
  localLevel,
  loading,
}: {
  adaptive: Adaptive | null
  localLevel: Difficulty
  loading: boolean
}) {
  const next = nextForYou(adaptive, localLevel)
  return (
    <section
      className="next-for-you"
      aria-label="Next for you"
      aria-busy={loading}
    >
      {loading ? (
        <div className="scam-profile-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          <h2 className="next-title">{next.title}</h2>
          <p>{next.reason}</p>
          <p className="next-level">
            Difficulty: <strong>{levelName(next.difficulty)}</strong>
          </p>
        </>
      )}
      <MadeForYouActions
        difficulty={next.difficulty}
        label="Start practice"
        withCall
      />
    </section>
  )
}

/**
 * After a debrief: what changed in Tellio's picture of this user, compared with
 * before the run, and the next step.
 */
export function LearnedPanel({
  learning,
  attemptId,
  withActions = true,
}: {
  learning: Learning
  attemptId: string
  withActions?: boolean
}) {
  if (learning.status === 'loading' || learning.status === 'off') return null
  const view =
    learning.status === 'ready'
      ? learned(learning.before, learning.after, attemptId)
      : null
  const difficulty =
    view?.next.difficulty ?? learning.before.adaptive?.difficulty ?? 'easy'

  return (
    <section
      className="learned"
      aria-labelledby="learned-title"
      aria-live="polite"
      aria-busy={learning.status === 'waiting'}
    >
      <h3 id="learned-title">What Tellio learned</h3>
      {learning.status === 'waiting' ? (
        <p className="learned-wait">
          <LoaderCircle size={16} className="spinner" aria-hidden="true" />
          Updating your profile…
        </p>
      ) : !view ? (
        <p className="learned-wait">
          Couldn't update your profile. It'll catch up next time.
        </p>
      ) : (
        <>
          <ul className="learned-list">
            {view.lines.slice(0, 2).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {view.insight && (
            <figure className="learned-insight">
              <blockquote>{view.insight.pattern}</blockquote>
              <figcaption>{insightSourceLabel(view.insight.source)}</figcaption>
            </figure>
          )}
          <p className="learned-next">
            Next up:{' '}
            <strong>{view.next.title.replace(/, made for you$/, '')}</strong> ·{' '}
            {levelName(view.next.difficulty)}
          </p>
        </>
      )}
      {withActions && learning.status !== 'waiting' && (
        <MadeForYouActions
          difficulty={difficulty}
          label="Next scenario made for you"
        />
      )}
    </section>
  )
}
