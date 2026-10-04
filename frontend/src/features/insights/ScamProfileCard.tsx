import { useScamProfile, type ScamProfileState } from './useScamProfile'
import './scamProfile.css'

function ProfileBody({
  state,
}: {
  state: Exclude<ScamProfileState, { status: 'error' }>
}) {
  if (state.status === 'loading') {
    return (
      <div className="scam-profile-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    )
  }

  const { view } = state
  if (view.empty) {
    return (
      <p>
        Nothing to read yet. After a few scenarios, chatisthisreal sums up what
        you catch and what to work on.
      </p>
    )
  }

  return (
    <>
      <p>{view.insight}</p>
      {(view.strongest || view.weakest) && (
        <dl className="scam-profile-facts">
          {view.strongest && (
            <div className="is-strong">
              <dt>Strongest</dt>
              <dd>{view.strongest}</dd>
            </div>
          )}
          {view.weakest && (
            <div className="is-weak">
              <dt>Work on</dt>
              <dd>{view.weakest}</dd>
            </div>
          )}
        </dl>
      )}
      <h3>How to improve</h3>
      <p>{view.recommendation}</p>
      {view.focus.length > 0 && (
        <ul className="home-flags" aria-label="Practise next">
          {view.focus.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      )}
      <p className="scam-profile-source">{view.sourceLine}</p>
    </>
  )
}

/**
 * Insights' closing summary: how the user is doing, then how to improve. Hidden
 * if the API fails.
 */
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
      <ProfileBody state={state} />
    </section>
  )
}
