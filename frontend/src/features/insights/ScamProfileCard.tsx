import { useScamProfile } from './useScamProfile'
import './scamProfile.css'

/** "What Tellio has learned": strongest skill, biggest weakness, one insight and what to practise next. Hidden if the API fails. */
export function ScamProfileCard({ uid }: { uid: string | null | undefined }) {
  const state = useScamProfile(uid)
  if (state.status === 'error') return null

  return (
    <section className="home-progress scam-profile" aria-labelledby="scam-profile-title" aria-busy={state.status === 'loading'}>
      <h2 id="scam-profile-title">What Tellio has learned</h2>
      {state.status === 'loading'
        ? (
          <div className="scam-profile-skeleton" aria-hidden="true">
            <span /><span /><span />
          </div>
        )
        : state.view.empty
          ? <p>Nothing to read yet. After a few scenarios, you'll see what you catch, what catches you, and what to practise next.</p>
          : (
            <>
              {(state.view.strongest || state.view.weakest) && (
                <dl className="scam-profile-facts">
                  {state.view.strongest && <div className="is-strong"><dt>Strongest skill</dt><dd>{state.view.strongest}</dd></div>}
                  {state.view.weakest && <div className="is-weak"><dt>Biggest weakness</dt><dd>{state.view.weakest}</dd></div>}
                </dl>
              )}
              <p>{state.view.insight}</p>
              {state.view.focus.length > 0 && (
                <>
                  <h3>Practise next</h3>
                  <ul className="home-flags">{state.view.focus.map((label) => <li key={label}>{label}</li>)}</ul>
                </>
              )}
              <p className="scam-profile-tip">{state.view.recommendation}</p>
            </>
          )}
      {state.status === 'ready' && !state.view.empty && <p className="home-saved">{state.view.sourceLine}</p>}
    </section>
  )
}
