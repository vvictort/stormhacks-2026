import { ArrowLeft, Mail, MessageSquareText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext'
import { Debrief } from '../features/training/components/Debrief'
import { PhoneSimulator } from '../features/training/components/PhoneSimulator'
import { TrainingHeader } from '../features/training/components/TrainingHeader'
import { recommend } from '../features/training/progress'
import { getScenario, hasLink, type Action, type Scenario } from '../features/training/scenarios'
import { useProgress } from '../features/training/useProgress'

const difficultyLabel = { easy: 'Gentle start', medium: 'A little trickier', hard: 'Tricky' }

export function ScenarioPage() {
  const { scenarioId } = useParams()
  const scenario = getScenario(scenarioId)

  return (
    <div className="train-shell">
      <TrainingHeader />
      {scenario ? <ScenarioRun key={scenario.id} scenario={scenario} /> : <MissingScenario />}
    </div>
  )
}

function ScenarioRun({ scenario }: { scenario: Scenario }) {
  const { user } = useAuth()
  const { progress, record } = useProgress(user?.uid)
  const [choice, setChoice] = useState<Action | null>(null)
  const [inspected, setInspected] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const email = scenario.type === 'email'

  useEffect(() => {
    document.title = `${scenario.title} · Tellio`
    // A new scenario is a new page: jump, don't glide, past the global smooth scroll.
    window.scrollTo({ top: 0, behavior: 'instant' })
    heading.current?.focus({ preventScroll: true })
  }, [scenario.title])

  function choose(action: Action) {
    setChoice(action)
    record(scenario.id, action === scenario.correctAction)
  }

  return (
    <main className="scenario-main">
      <div className="scenario-intro">
        <Link className="train-back" to="/home"><ArrowLeft size={16} aria-hidden="true" />All scenarios</Link>
        <h1 ref={heading} tabIndex={-1}>{scenario.title}</h1>
        <p className="scenario-meta">{email ? <Mail size={15} aria-hidden="true" /> : <MessageSquareText size={15} aria-hidden="true" />} {email ? 'Email' : 'Text message'} <span aria-hidden="true">·</span> {difficultyLabel[scenario.difficulty]}</p>
        <p className="scenario-situation"><strong>What you know:</strong> {scenario.situation}</p>
      </div>

      <PhoneSimulator scenario={scenario} choice={choice} onChoose={choose} onInspect={() => { if (!choice) setInspected(true) }} />

      <div className="scenario-panel">
        {choice
          ? <Debrief scenario={scenario} choice={choice} inspected={inspected} next={recommend(progress, scenario.id)} />
          : (
            <div className="scenario-howto">
              <h2>Treat it like your own phone</h2>
              <ol>
                <li>Read the {email ? 'email' : 'message'} the way you would if it had just arrived.</li>
                {email && <li>Tap the sender's name to see the address it really came from.</li>}
                {hasLink(scenario) && <li>Tap the link to see where it goes. Practice links never open.</li>}
                <li>Then choose <strong>Looks safe</strong> or <strong>Report &amp; block</strong>.</li>
              </ol>
            </div>
          )}
      </div>
    </main>
  )
}

function MissingScenario() {
  useEffect(() => { document.title = 'Scenario not found · Tellio' }, [])
  return (
    <main className="scenario-missing">
      <h1>We couldn't find that scenario.</h1>
      <p>It may have been renamed. Your practice path has everything that's available.</p>
      <Link className="train-primary" to="/home">Back to home</Link>
    </main>
  )
}
