import { ArrowRight } from 'lucide-react'
import { useEffect } from 'react'
import { Brand } from '../components/Brand'
import { Mascot } from '../components/Mascot'
import { RevealText } from '../components/RevealText'
import { TransitionLink } from '../components/TransitionLink'
import { useAuth } from '../features/auth/AuthContext'
import '../features/training/training.css'

const checks = [
  { title: 'Read the web address before you tap', detail: 'Look at the part just before the first single slash. "bank.secure-login.info" is secure-login.info, whatever words come in front.' },
  { title: 'Ask whether you were expecting it', detail: 'A parcel fee, a locked account or a prize you never entered for is a reason to slow down, not to hurry.' },
  { title: 'Notice the rush', detail: '"Within 24 hours" or "your account will be closed" is there to stop you checking.' },
  { title: 'Go the long way round', detail: "Open the company's app or type its address yourself. If something really needs doing, it will be there too." },
]

/**
 * Public page that tracked practice links redirect to (`/caught?sim=<threadId>`). Signed out is fine:
 * it only teaches, and records nothing. The click itself was already recorded by the comms service.
 */
export function CaughtPage() {
  const { user } = useAuth()
  useEffect(() => { document.title = 'That was a practice link · Tellio' }, [])

  return (
    <div className="train-shell">
      <header className="train-header"><Brand to={user ? '/home' : '/login'} /></header>
      <main className="caught-main">
        <div className="caught-verdict">
          <Mascot className="caught-mascot" mood="alert" />
          <RevealText as="h1" text="That link was part of a practice scam." />
        </div>
        <p className="caught-lede">
          You tapped a link in a simulated message from Tellio. Nothing happened: no site opened, nothing was downloaded and none of your details went anywhere.
          On a real scam, this is the moment a fake page would ask for your password or card.
        </p>
        <h2>Four checks before tapping a link</h2>
        <ol className="debrief-clues">
          {checks.map((check, i) => (
            <li key={check.title}>
              <span className="clue-num" aria-hidden="true">{i + 1}</span>
              <div><strong>{check.title}</strong><p>{check.detail}</p></div>
            </li>
          ))}
        </ol>
        <div className="debrief-actions">
          {user
            ? <TransitionLink direction="back" className="train-primary" to="/home">Back to your practice<ArrowRight size={17} aria-hidden="true" /></TransitionLink>
            : <TransitionLink className="train-primary" to="/login">Sign in to keep practising<ArrowRight size={17} aria-hidden="true" /></TransitionLink>}
        </div>
      </main>
    </div>
  )
}
