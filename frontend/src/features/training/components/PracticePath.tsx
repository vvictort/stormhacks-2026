import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TransitionLink } from '../../../components/TransitionLink'
import type { Progress } from '../progress'
import { scenarios, type Scenario } from '../scenarios'

const channelLabel = { sms: 'Text message', email: 'Email', call: 'Phone call' }
const channelTabs = [{ id: 'all', label: 'All' }, { id: 'sms', label: 'Texts' }, { id: 'email', label: 'Emails' }, { id: 'call', label: 'Calls' }] as const
const statusTabs = [{ id: 'all', label: 'All' }, { id: 'todo', label: 'To try' }, { id: 'missed', label: 'Missed' }, { id: 'right', label: 'Right' }] as const
const statusText = { right: 'Right call', missed: 'Missed', todo: 'Not tried' }
// ponytail: client-side paging over the whole list; page from the server when the library outgrows one JSON.
const PAGE = 12

type State = keyof typeof statusText
const stateOf = (scenario: Scenario, progress: Progress): State => {
  const attempt = progress[scenario.id]
  return attempt ? (attempt.correct ? 'right' : 'missed') : 'todo'
}

/** Every scenario, filtered by channel and result (kept in the URL), a page at a time. */
export function PracticePath({ progress }: { progress: Progress }) {
  const [params, setParams] = useSearchParams()
  const channel = params.get('channel') ?? 'all'
  const status = params.get('status') ?? 'all'
  const [shown, setShown] = useState(PAGE)

  function pick(key: 'channel' | 'status', value: string) {
    const next = new URLSearchParams(params)
    if (value === 'all') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
    setShown(PAGE)
  }

  const inChannel = channel === 'all' ? scenarios : scenarios.filter((scenario) => scenario.type === channel)
  const count = (id: string) => id === 'all' ? inChannel.length : inChannel.filter((scenario) => stateOf(scenario, progress) === id).length
  const list = status === 'all' ? inChannel : inChannel.filter((scenario) => stateOf(scenario, progress) === status)

  return (
    <section className="path" aria-label="All scenarios">
      <div className="path-filters">
        <div className="segmented" role="group" aria-label="Channel">
          {channelTabs.map((tab) => (
            <button key={tab.id} type="button" aria-pressed={channel === tab.id} onClick={() => pick('channel', tab.id)}>{tab.label}</button>
          ))}
        </div>
        <div className="path-chips" role="group" aria-label="Result">
          {statusTabs.map((tab) => (
            <button key={tab.id} type="button" aria-pressed={status === tab.id} onClick={() => pick('status', tab.id)}>
              {tab.label} <span className="path-chip-count">{count(tab.id)}</span>
            </button>
          ))}
        </div>
      </div>

      {list.length === 0
        ? <p className="path-empty">Nothing here yet.</p>
        : (
          <ol className="path-stops">
            {list.slice(0, shown).map((scenario) => <PathStop key={scenario.id} scenario={scenario} progress={progress} />)}
          </ol>
        )}
      {list.length > shown && (
        <button type="button" className="train-ghost path-more" onClick={() => setShown(shown + PAGE)}>Show more <span className="path-chip-count">{list.length - shown}</span></button>
      )}
    </section>
  )
}

export function PathStop({ scenario, progress, upNext = false }: { scenario: Scenario; progress: Progress; upNext?: boolean }) {
  const state = stateOf(scenario, progress)
  return (
    <li className={`path-stop is-${state}${upNext ? ' is-upnext' : ''}`}>
      <span className="path-channel">{channelLabel[scenario.type]}</span>
      <div className="path-stop-body">
        {/* Shares a transition name with the scenario heading, so the title morphs into the page. */}
        <TransitionLink className="path-stop-link" to={`/train/${scenario.id}`} style={{ viewTransitionName: `title-${scenario.id}` }}>{scenario.title}</TransitionLink>
        <p>{scenario.summary}</p>
      </div>
      <span className="path-status">{upNext ? 'Up next' : statusText[state]}</span>
    </li>
  )
}
