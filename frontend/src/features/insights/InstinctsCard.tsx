import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { instinctsView, type Metrics } from './instincts'
import { tracker } from './track'
import './instincts.css'

/** "Your scam instincts": how fast and how well the user decides, then against now. Hidden if the metrics can't load. */
export function InstinctsCard({ uid }: { uid: string | null | undefined }) {
  const [state, setState] = useState<{ uid?: string | null; metrics?: Metrics | null }>({})

  useEffect(() => {
    if (!uid) return
    const controller = new AbortController()
    // Send anything still queued from the last scenario first, so it counts.
    tracker.flush()
      .then(() => api<Metrics>('/training/metrics', { signal: controller.signal }, uid))
      .then((metrics) => { if (!controller.signal.aborted) setState({ uid, metrics }) })
      .catch(() => { if (!controller.signal.aborted) setState({ uid, metrics: null }) })
    return () => controller.abort()
  }, [uid])

  if (state.uid !== uid || !state.metrics) return null
  const view = instinctsView(state.metrics)

  return (
    <section className="home-progress home-instincts" aria-labelledby="instincts-title">
      <h2 id="instincts-title">Your scam instincts</h2>
      {!view
        ? <p>Finish a couple of scenarios and Tellio will start timing your instincts.</p>
        : (
          <>
            <dl className="instincts-list">
              {view.rows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.then && <><span className="instincts-then">{row.then}</span><ArrowRight size={14} aria-hidden="true" className="instincts-arrow" /><span className="sr-only"> to </span></>}
                    <strong className={row.better ? 'is-better' : undefined}>{row.now}</strong>
                  </dd>
                </div>
              ))}
              {view.improved && <div><dt>Most improved</dt><dd><strong className="is-better">{view.improved}</strong></dd></div>}
            </dl>
            <p className="instincts-note">{view.note}</p>
          </>
        )}
      <p className="instincts-source">Every tap and decision is timed and stored in TigerData.</p>
    </section>
  )
}
