import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import {
  instinctsChart,
  instinctsSource,
  instinctsView,
  type Metrics,
} from './instincts'
import { tracker } from './track'
import './instincts.css'

/**
 * "Speed and trend": how fast and how well the user decides, then against now.
 * Hidden if the metrics can't load.
 */
export function InstinctsCard({ uid }: { uid: string | null | undefined }) {
  const [state, setState] = useState<{
    uid?: string | null
    metrics?: Metrics | null
  }>({})

  useEffect(() => {
    if (!uid) return
    const controller = new AbortController()
    // Send anything still queued from the last scenario first, so it counts.
    tracker
      .flush()
      .then(() =>
        api<Metrics>('/training/metrics', { signal: controller.signal }, uid),
      )
      .then((metrics) => {
        if (!controller.signal.aborted) setState({ uid, metrics })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ uid, metrics: null })
      })

    return () => controller.abort()
  }, [uid])

  if (state.uid !== uid || !state.metrics) return null
  const view = instinctsView(state.metrics)
  const chart = instinctsChart(state.metrics)

  return (
    // Part of Insights' numbers, right after the results: a sub-block, not a
    // card of its own.
    <section className="home-instincts" aria-labelledby="instincts-title">
      {/* What's compared sits by the heading, so the then → now numbers read
          right. */}
      <div className="home-stat-head">
        <h2 id="instincts-title">Speed and trend</h2>
        {view && <span>{view.note}</span>}
      </div>
      {!view ? (
        <p>
          Finish a couple of scenarios and Tellio will start timing your
          instincts.
        </p>
      ) : (
        <>
          <dl className="instincts-list">
            {view.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  {row.then && (
                    <>
                      <span className="instincts-then">{row.then}</span>
                      <ArrowRight
                        size={14}
                        aria-hidden="true"
                        className="instincts-arrow"
                      />
                      <span className="sr-only"> to </span>
                    </>
                  )}
                  <strong className={row.better ? 'is-better' : undefined}>
                    {row.now}
                  </strong>
                </dd>
              </div>
            ))}
            {view.improved && (
              <div>
                <dt>Most improved</dt>
                <dd>
                  <strong className="is-better">{view.improved}</strong>
                </dd>
              </div>
            )}
          </dl>
          {chart && <MiniBars chart={chart} />}
        </>
      )}
      <p className="instincts-source">
        {instinctsSource(state.metrics.storage)}
      </p>
    </section>
  )
}

const BAR = 10
const GAP = 4
const HEIGHT = 44

/**
 * A few inline SVG bars; each bar's label is its tooltip, and the whole series
 * is the image's accessible name.
 */
function MiniBars({
  chart,
}: {
  chart: NonNullable<ReturnType<typeof instinctsChart>>
}) {
  return (
    <figure className="instincts-chart">
      <svg
        width={chart.bars.length * (BAR + GAP) - GAP}
        height={HEIGHT}
        role="img"
        aria-label={`${chart.title}. ${chart.bars.map((bar) => bar.label).join('; ')}`}
      >
        {chart.bars.map((bar, i) => {
          const height = Math.max(3, Math.round(bar.height * HEIGHT))
          return (
            <rect
              key={i}
              x={i * (BAR + GAP)}
              y={HEIGHT - height}
              width={BAR}
              height={height}
              rx={2}
              className={bar.good ? 'is-good' : 'is-missed'}
            >
              <title>{bar.label}</title>
            </rect>
          )
        })}
      </svg>
      <figcaption>
        {chart.title}
        <span className="instincts-key is-good">{chart.keys[0]}</span>
        <span className="instincts-key is-missed">{chart.keys[1]}</span>
      </figcaption>
    </figure>
  )
}
