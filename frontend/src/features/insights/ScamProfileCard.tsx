import { useScamProfile } from './useScamProfile'
import './scamProfile.css'

/** Insights' closing summary: how the user is doing, then how to improve. Hidden if the API fails. */
export function ScamProfileCard({ uid }: { uid: string | null | undefined }) {
  const state = useScamProfile(uid)
  if (state.status === 'error') return null

  return (
    <section
      className="scam-profile"
      aria-labelledby="scam-profile-title"
      aria-busy={state.status === 'loading'}
    >
      <h2 id="scam-profile-title">How you're doing</h2>
      {state.status === 'loading' ? (
        <div className="scam-profile-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : state.view.empty ? (
        <p>
          Nothing to read yet. After a few scenarios, Tellio sums up what you
          catch and what to work on.
        </p>
      ) : (
        <>
          <p>{state.view.insight}</p>
          {(state.view.strongest || state.view.weakest) && (
            <dl className="scam-profile-facts">
              {state.view.strongest && (
                <div className="is-strong">
                  <dt>Strongest</dt>
                  <dd>{state.view.strongest}</dd>
                </div>
              )}
              {state.view.weakest && (
                <div className="is-weak">
                  <dt>Work on</dt>
                  <dd>{state.view.weakest}</dd>
                </div>
              )}
            </dl>
          )}
          <h3>How to improve</h3>
          <p>{state.view.recommendation}</p>
          {state.view.focus.length > 0 && (
            <ul className="home-flags" aria-label="Practise next">
              {state.view.focus.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          )}
          <p className="scam-profile-source">{state.view.sourceLine}</p>
        </>
      )}
    </section>
  )
}
