import {
  Check,
  History as HistoryIcon,
  Mail,
  MessageSquareText,
  Phone,
  RotateCcw,
} from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TransitionLink } from '../../../components/TransitionLink'
import type { Progress } from '../progress'
import { timeline } from '../progress'
import { getCachedScenarioMeta } from '../scenarioCache'
import { getScenario, type Channel, type Difficulty } from '../scenarios'

const channelIcon: Record<Channel, typeof MessageSquareText> = {
  sms: MessageSquareText,
  email: Mail,
  call: Phone,
}

const channelLabels: Record<Channel, string> = {
  sms: 'Text',
  email: 'Email',
  call: 'Call',
}

const channelTabs = [
  { id: 'all', label: 'All' },
  { id: 'sms', label: 'Texts' },
  { id: 'email', label: 'Emails' },
  { id: 'call', label: 'Calls' },
] as const

const statusTabs = [
  { id: 'missed', label: 'Missed' },
  { id: 'right', label: 'Right' },
] as const

const statusText = {
  right: 'Right call',
  missed: 'Missed',
} as const

const PAGE = 12

export interface HistoryAttempt {
  id: string
  key: string
  title: string
  summary: string
  type: Channel
  correct: boolean
  at: number
  difficulty?: Difficulty
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp || Number.isNaN(timestamp)) return ''
  const diff = Math.max(0, Date.now() - timestamp)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

function resolveAttempt(
  attempt: { id: string; correct: boolean; at: number },
  index: number,
): HistoryAttempt {
  const staticScenario = getScenario(attempt.id)
  const cached = getCachedScenarioMeta(attempt.id)

  let type: Channel = staticScenario?.type ?? cached?.type ?? 'call'
  if (!staticScenario && !cached) {
    if (attempt.id.startsWith('gen-sms-') || attempt.id.includes('sms')) {
      type = 'sms'
    } else if (
      attempt.id.startsWith('gen-email-') ||
      attempt.id.includes('email')
    ) {
      type = 'email'
    } else if (
      attempt.id.startsWith('gen-call-') ||
      attempt.id.includes('call')
    ) {
      type = 'call'
    }
  }

  const defaultTitle = {
    sms: 'Personalised text message',
    email: 'Personalised phishing email',
    call: 'AI voice scam call',
  }[type]
  const title = staticScenario?.title ?? cached?.title ?? defaultTitle

  const defaultSummary = {
    sms: 'Smishing text message simulation tailored for you',
    email: 'Phishing inbox simulation tailored for you',
    call: 'Interactive scam phone call simulation',
  }[type]
  const summary = staticScenario?.summary ?? cached?.summary ?? defaultSummary

  const at =
    typeof attempt.at === 'number' && !Number.isNaN(attempt.at)
      ? attempt.at
      : Date.now()

  return {
    id: attempt.id,
    key: `${attempt.id}-${at}-${index}`,
    title,
    summary,
    type,
    correct: attempt.correct,
    at,
    difficulty: staticScenario?.difficulty ?? cached?.difficulty,
  }
}

function EmptyHistory() {
  return (
    <div className="path-empty-card">
      <div className="path-empty-icon-wrap">
        <HistoryIcon size={28} aria-hidden="true" />
      </div>
      <h3>No completed scenarios yet</h3>
      <p>
        When you practice phone calls, inspect phishing emails, or review
        smishing texts, your completed simulations and decisions will appear
        here.
      </p>
      <TransitionLink
        to="/?tab=practice"
        className="train-primary path-empty-btn"
      >
        Start practicing
      </TransitionLink>
    </div>
  )
}

/** What to say when the chosen filters leave nothing to list. */
function emptyFilterText(channel: string, status: string | null) {
  const label = channelTabs.find((tab) => tab.id === channel)?.label ?? channel
  const where = channel === 'all' ? 'history' : label

  if (status === 'missed') return `No missed scenarios in ${where}. Nice work!`
  if (status === 'right') return `No right calls recorded in ${where} yet.`
  return `No ${label} scenarios completed yet.`
}

/**
 * Attempted scenarios, filtered by channel and result (kept in the URL), newest
 * first.
 */
export function PracticePath({ progress }: { progress: Progress }) {
  const [params, setParams] = useSearchParams()
  const channel = params.get('channel') ?? 'all'
  const status = params.get('status')
  const [shown, setShown] = useState(PAGE)

  function pick(key: 'channel' | 'status', value: string) {
    const next = new URLSearchParams(params)
    if (value === 'all' || params.get(key) === value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
    setShown(PAGE)
  }

  const allAttempts = timeline(progress)
    .map(resolveAttempt)
    .sort((a, b) => b.at - a.at)

  const inChannel =
    channel === 'all'
      ? allAttempts
      : allAttempts.filter((item) => item.type === channel)
  const count = (id: 'missed' | 'right') =>
    inChannel.filter((item) => (id === 'right' ? item.correct : !item.correct))
      .length
  const list =
    status === 'missed' || status === 'right'
      ? inChannel.filter((item) =>
          status === 'right' ? item.correct : !item.correct,
        )
      : inChannel

  let results = (
    <ol className="path-stops">
      {list.slice(0, shown).map((attempt) => (
        <HistoryStop key={attempt.key} attempt={attempt} />
      ))}
    </ol>
  )
  if (allAttempts.length === 0) {
    results = <EmptyHistory />
  } else if (list.length === 0) {
    results = (
      <div className="path-empty-filter">
        <p>{emptyFilterText(channel, status)}</p>
      </div>
    )
  }

  return (
    <section className="path" aria-label="Practice history">
      <div className="path-filters">
        <div className="segmented" role="group" aria-label="Channel">
          {channelTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={channel === tab.id}
              onClick={() => pick('channel', tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {/* Toggles: pressing the active result again shows every result. */}
        <div className="path-chips" role="group" aria-label="Result">
          {statusTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={status === tab.id}
              onClick={() => pick('status', tab.id)}
            >
              {tab.label}{' '}
              <span className="path-chip-count">{count(tab.id)}</span>
            </button>
          ))}
        </div>
      </div>

      {results}

      {list.length > shown && (
        <button
          type="button"
          className="train-ghost path-more"
          onClick={() => setShown(shown + PAGE)}
        >
          Show more{' '}
          <span className="path-chip-count">{list.length - shown}</span>
        </button>
      )}
    </section>
  )
}

export function HistoryStop({ attempt }: { attempt: HistoryAttempt }) {
  const Icon = channelIcon[attempt.type]
  const state = attempt.correct ? 'right' : 'missed'
  return (
    <li className={`path-stop is-${state}`}>
      <span className="path-dot" aria-hidden="true">
        {attempt.correct ? (
          <Check size={12} strokeWidth={3} />
        ) : (
          <RotateCcw size={11} strokeWidth={3} />
        )}
      </span>
      <div className="path-stop-body">
        <div className="path-stop-meta">
          <span className="path-channel-tag">
            <Icon size={12} aria-hidden="true" />
            <span>{channelLabels[attempt.type]}</span>
          </span>
          {attempt.difficulty && (
            <span className="path-diff-tag">{attempt.difficulty}</span>
          )}
        </div>
        <TransitionLink
          className="path-stop-link"
          to={`/train/${attempt.id}`}
          style={{ viewTransitionName: `title-${attempt.id}` }}
        >
          {attempt.title}
        </TransitionLink>
        <p>{attempt.summary}</p>
      </div>
      <div className="path-stop-end">
        <span className="path-status">{statusText[state]}</span>
        <time
          className="path-time"
          dateTime={new Date(attempt.at).toISOString()}
          title={new Date(attempt.at).toLocaleString()}
        >
          {formatRelativeTime(attempt.at)}
        </time>
      </div>
    </li>
  )
}
