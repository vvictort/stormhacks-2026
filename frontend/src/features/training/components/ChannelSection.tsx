import { ArrowRight, LoaderCircle, Sparkles, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TransitionLink } from '../../../components/TransitionLink'
import { api } from '../../../lib/api'
import { preloadPages } from '../../../lib/lazyPage'
import { withViewTransition } from '../../../lib/viewTransition'
import { requestPersonalisedCall } from '../call/requestCall'
import { generateScenario } from '../generate'
import type { Progress } from '../progress'
import { channelStats } from '../progress'
import { scenarios, type Channel, type Difficulty, type Scenario } from '../scenarios'
import './channelSection.css'

export interface ChannelSectionProps {
  channel: Channel
  title: string
  subtitle: string
  badge: string
  Icon: LucideIcon
  progress: Progress
  scenarios?: Scenario[]
  adaptiveDifficulty?: Difficulty
}

export function ChannelSection({
  channel,
  title,
  subtitle,
  badge,
  Icon,
  progress,
  scenarios: channelScenarios,
  adaptiveDifficulty = 'easy',
}: ChannelSectionProps) {
  const navigate = useNavigate()
  const [pending, setPending] = useState<'email' | 'call' | 'sms' | null>(null)
  const [failed, setFailed] = useState<{ message: string; fallbackId?: string }>()

  // Overall channel stats
  const stats = channelStats(progress)[channel]
  const rate = stats.attempts ? Math.round((stats.right / stats.attempts) * 100) : 0

  async function handleGenerate(type: 'email' | 'call' | 'sms') {
    setPending(type)
    setFailed(undefined)
    try {
      let id: string
      if (type === 'call') {
        id = await requestPersonalisedCall()
      } else {
        id = (await generateScenario(api, type)).id
      }
      await preloadPages().catch(() => {})
      withViewTransition('forward', () => navigate(`/train/${id}`))
    } catch (error) {
      const pool = channelScenarios ?? scenarios
      const fallback = pool.find((s) => s.type === type && s.difficulty === adaptiveDifficulty) ?? pool.find((s) => s.type === type)
      setFailed({
        message: type === 'email'
          ? (error as Error).message || "Couldn't write an email scenario just now."
          : type === 'sms'
            ? (error as Error).message || "Couldn't write a text message scenario just now."
            : "Couldn't set up a personalized call scenario just now.",
        fallbackId: fallback?.id,
      })
      setPending(null)
    }
  }

  return (
    <section className={`channel-section channel-${channel}`} id={`section-${channel}`} aria-labelledby={`title-${channel}`}>
      <div className="channel-header">
        <div className="channel-identity">
          <div className="channel-icon-wrap" aria-hidden="true">
            <Icon size={22} />
          </div>
          <div className="channel-headings">
            <div className="channel-title-row">
              <h2 className="channel-title" id={`title-${channel}`}>{title}</h2>
              <span className="channel-badge">{badge}</span>
            </div>
            <p className="channel-blurb">{subtitle}</p>
          </div>
        </div>

        <div className="channel-stats" aria-label={`${title} statistics`}>
          <div className="channel-accuracy">
            {stats.attempts > 0 ? (
              <><strong>{rate}%</strong> accuracy</>
            ) : (
              <span>Not tried yet</span>
            )}
          </div>
          <div className="channel-meter-row">
            <div className="channel-meter" aria-hidden="true">
              <span style={{ width: `${rate}%` }} />
            </div>
            <span className="channel-completion">
              {stats.attempts > 0
                ? `${stats.right} of ${stats.attempts} right`
                : 'Ready to start'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Action Box */}
      <div className="channel-action-box">
        {channel === 'call' && (
          <>
            <div className="channel-action-prompt">
              <strong>Interactive Voice AI:</strong> Answer simulated scam calls in real-time or practice hang-up judgment.
            </div>
            <div className="channel-action-buttons">
              <button
                type="button"
                className="train-primary"
                id="btn-take-call"
                onClick={() => void handleGenerate('call')}
                disabled={pending !== null}
                aria-busy={pending === 'call'}
              >
                {pending === 'call' ? (
                  <><LoaderCircle size={16} className="spinner" aria-hidden="true" />Setting up call…</>
                ) : (
                  <><Icon size={16} aria-hidden="true" />Take a call made for you</>
                )}
              </button>
              <TransitionLink className="train-ghost" to={`/?tab=history&channel=${channel}`}>
                Browse library in History<ArrowRight size={14} aria-hidden="true" />
              </TransitionLink>
            </div>
          </>
        )}

        {channel === 'email' && (
          <>
            <div className="channel-action-prompt">
              <strong>AI Phishing Inbox:</strong> Inspect look-alike sender domains, urgent fake invoices, and deceptive links.
            </div>
            <div className="channel-action-buttons">
              <button
                type="button"
                className="train-primary"
                id="btn-generate-email"
                onClick={() => void handleGenerate('email')}
                disabled={pending !== null}
                aria-busy={pending === 'email'}
              >
                {pending === 'email' ? (
                  <><LoaderCircle size={16} className="spinner" aria-hidden="true" />Writing email…</>
                ) : (
                  <><Sparkles size={16} aria-hidden="true" />Generate an email made for you</>
                )}
              </button>
              <TransitionLink className="train-ghost" to={`/?tab=history&channel=${channel}`}>
                Browse library in History<ArrowRight size={14} aria-hidden="true" />
              </TransitionLink>
            </div>
          </>
        )}

        {channel === 'sms' && (
          <>
            <div className="channel-action-prompt">
              <strong>Simulated SMS Phone:</strong> Catch deceptive delivery reroutes, bank 2FA scams, and smishing attacks.
            </div>
            <div className="channel-action-buttons">
              <button
                type="button"
                className="train-primary"
                id="btn-generate-sms"
                onClick={() => void handleGenerate('sms')}
                disabled={pending !== null}
                aria-busy={pending === 'sms'}
              >
                {pending === 'sms' ? (
                  <><LoaderCircle size={16} className="spinner" aria-hidden="true" />Writing text message…</>
                ) : (
                  <><Sparkles size={16} aria-hidden="true" />Generate a text message made for you</>
                )}
              </button>
              <TransitionLink className="train-ghost" to={`/?tab=history&channel=${channel}`}>
                Browse library in History<ArrowRight size={14} aria-hidden="true" />
              </TransitionLink>
            </div>
          </>
        )}

        {failed && (
          <p className="channel-action-error" role="alert">
            {failed.message}{' '}
            {failed.fallbackId && (
              <TransitionLink className="text-link" to={`/train/${failed.fallbackId}`}>
                Try a library scenario instead<ArrowRight size={13} aria-hidden="true" />
              </TransitionLink>
            )}
          </p>
        )}
      </div>
    </section>
  )
}
