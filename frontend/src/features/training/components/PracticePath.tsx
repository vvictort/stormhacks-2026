import { Check, Mail, MessageSquareText, Phone, RotateCcw } from 'lucide-react'
import { TransitionLink } from '../../../components/TransitionLink'
import type { Progress } from '../progress'
import { channels, scenarios, type Scenario } from '../scenarios'

const channelIcon = { sms: MessageSquareText, email: Mail, call: Phone }

export function PracticePath({ progress, upNextId }: { progress: Progress; upNextId?: string }) {
  return (
    <section className="path" aria-labelledby="path-title">
      <h2 id="path-title">Your practice path</h2>
      <ol className="path-list">
        {channels.map((channel) => {
          const Icon = channelIcon[channel.type]
          return (
            <li key={channel.type} className={`path-channel${channel.ready ? '' : ' is-soon'}`}>
              <div className="path-channel-head">
                <span className="path-node" aria-hidden="true"><Icon size={18} /></span>
                <h3>{channel.name}</h3>
                {!channel.ready && <span className="path-soon">Coming soon</span>}
              </div>
              {channel.ready
                ? (
                  <ol className="path-stops">
                    {scenarios.filter((scenario) => scenario.type === channel.type).map((scenario) => (
                      <PathStop key={scenario.id} scenario={scenario} progress={progress} upNext={scenario.id === upNextId} />
                    ))}
                  </ol>
                )
                : <p className="path-blurb">{channel.blurb}</p>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function PathStop({ scenario, progress, upNext }: { scenario: Scenario; progress: Progress; upNext: boolean }) {
  const attempt = progress[scenario.id]
  const state = attempt ? (attempt.correct ? 'right' : 'missed') : upNext ? 'next' : 'new'
  const status = { right: 'Right call', missed: 'Worth another try', next: 'Up next', new: 'Not tried yet' }[state]

  return (
    <li className={`path-stop is-${state}${upNext ? ' is-upnext' : ''}`}>
      <span className="path-dot" aria-hidden="true">
        {state === 'right' && <Check size={11} strokeWidth={3} />}
        {state === 'missed' && <RotateCcw size={10} strokeWidth={3} />}
      </span>
      <div className="path-stop-body">
        {/* Shares a transition name with the scenario heading, so the title morphs into the page. */}
        <TransitionLink className="path-stop-link" to={`/train/${scenario.id}`} style={{ viewTransitionName: `title-${scenario.id}` }}>{scenario.title}</TransitionLink>
        <p>{scenario.summary}</p>
      </div>
      <span className="path-status">{upNext && attempt ? 'Up next' : status}</span>
    </li>
  )
}
