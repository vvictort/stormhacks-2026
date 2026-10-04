import { useEffect, useRef } from 'react'
import './Mascot.css'

export type MascotMood = 'idle' | 'curious' | 'suspicious' | 'alert' | 'happy'

interface Pose { eye: number; squint: number; pupil: number; happy: number; browOp: number; brows: number[]; mouth: string; filled: boolean }

// Each mood is a set of targets the rig eases toward.
const MOODS: Record<MascotMood, Pose> = {
  idle: { eye: 1, squint: 1, pupil: 1, happy: 0, browOp: 0, brows: [68, 72, 88, 70, 112, 70, 132, 72], mouth: 'M90 114 Q100 122 110 114', filled: false },
  curious: { eye: 1.14, squint: 1, pupil: 1.12, happy: 0, browOp: 1, brows: [68, 68, 88, 65, 112, 65, 132, 68], mouth: 'M95 117 Q100 120 105 117', filled: false },
  suspicious: { eye: 1, squint: 0.4, pupil: 1, happy: 0, browOp: 1, brows: [68, 79, 90, 84, 111, 74, 132, 69], mouth: 'M90 118 Q95 114 100 118 Q105 122 110 117', filled: false },
  alert: { eye: 1.2, squint: 1, pupil: 0.68, happy: 0, browOp: 1, brows: [67, 66, 87, 61, 113, 61, 133, 66], mouth: 'M100 110 C104.5 110 106.5 113.5 106.5 117.5 C106.5 121.5 104 124 100 124 C96 124 93.5 121.5 93.5 117.5 C93.5 113.5 95.5 110 100 110 Z', filled: true },
  happy: { eye: 1, squint: 1, pupil: 1, happy: 1, browOp: 0, brows: [68, 72, 88, 70, 112, 70, 132, 72], mouth: 'M87 111 Q100 115 113 111 Q111 127 100 127 Q89 127 87 111 Z', filled: true },
}

const CX = 100, CY = 96, RX = 66, RY = 58, POINTS = 22, FOOT = 154
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const superellipse = (c: number) => Math.sign(c) * Math.abs(c) ** 0.78
const f = (n: number, d = 2) => n.toFixed(d)

// Closed Catmull-Rom spline through the points, as cubic Béziers.
function smooth(p: [number, number][]) {
  const n = p.length
  let d = `M${f(p[0][0], 1)} ${f(p[0][1], 1)}`
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n]
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6, 1)} ${f(p1[1] + (p2[1] - p0[1]) / 6, 1)} ${f(p2[0] - (p3[0] - p1[0]) / 6, 1)} ${f(p2[1] - (p3[1] - p1[1]) / 6, 1)} ${f(p2[0], 1)} ${f(p2[1], 1)}`
  }
  return d + 'Z'
}

/** Tell, the speech-bubble mascot. Decorative: it follows the pointer, blinks, and acts out `mood`. */
export function Mascot({ mood = 'idle', className = '' }: { mood?: MascotMood; className?: string }) {
  const svg = useRef<SVGSVGElement>(null)
  const moodRef = useRef(mood)
  const kick = useRef<(m: MascotMood) => void>(() => {})

  useEffect(() => {
    moodRef.current = mood
    kick.current(mood)
  }, [mood])

  useEffect(() => {
    const root = svg.current!
    const $ = (s: string) => root.querySelector(s) as SVGElement
    const $$ = (s: string) => [...root.querySelectorAll(s)] as SVGElement[]
    const el = { rig: $('.rig'), body: $('.body'), tail: $('.tail'), face: $('.face'), lids: $$('.lid'), irises: $$('.iris'), happy: $$('.happy-eye'), brows: $$('.brow'), mouth: $('.mouth'), shadow: $('.shadow'), beacon: $('.beacon') }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const seed = Math.random() * 100
    const now = () => performance.now() / 1000
    const pointer = { x: 0, y: 0, at: -1e9 }
    const start = MOODS[moodRef.current]
    const cur = { ...start, brows: [...start.brows], fx: 0, fy: 0, px: 0, py: 0, tilt: 0, lx: 0, ly: 0 }
    const st = { s: 0, v: 0, hops: 0, hopAt: 0, shakeAt: -9, blinkAt: -9, nextBlink: 1 + Math.random() * 2, wander: { x: 0, y: 0, at: 0 }, mouth: '' }
    const impulse = (v: number) => { if (!reduce) st.v += v }

    kick.current = (m) => {
      const t = now()
      if (m === 'happy' && !reduce) { st.hops = 2; st.hopAt = t + 0.1; impulse(1.6) }
      else if (m === 'alert') { if (!reduce) st.shakeAt = t; impulse(1.2) }
      else impulse(0.8)
    }

    const onMove = (e: PointerEvent) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.at = performance.now() }
    const onDown = () => impulse(3.2)
    addEventListener('pointermove', onMove, { passive: true })
    root.addEventListener('pointerdown', onDown)

    let raf = 0, prev = now()
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const t = now(), dt = Math.min(0.05, t - prev)
      prev = t
      const r = root.getBoundingClientRect()
      if (!r.width) return // hidden, e.g. the editorial column on small screens

      const m = MOODS[moodRef.current], k = 1 - Math.exp(-dt * 9)
      const ox = r.left + r.width / 2, oy = r.top + r.height * 0.47
      const tracking = performance.now() - pointer.at < 2600
      // Where to look: the pointer if it moved recently, otherwise glance around.
      let tx: number, ty: number
      if (tracking) {
        const dx = pointer.x - ox, dy = pointer.y - oy, d = Math.hypot(dx, dy) || 1, mag = Math.min(1, d / (r.width * 0.9 + 40))
        tx = dx / d * mag; ty = dy / d * mag
      } else {
        if (t > st.wander.at) {
          const a = Math.random() * Math.PI * 2, g = Math.random() < 0.3 ? 0 : 0.5 + Math.random() * 0.5
          st.wander = { x: Math.cos(a) * g, y: Math.sin(a) * g * 0.6, at: t + 1.2 + Math.random() * 2 }
        }
        tx = st.wander.x; ty = st.wander.y
      }
      const near = tracking && Math.hypot(pointer.x - ox, pointer.y - oy) < r.width * 0.7
      cur.lx = lerp(cur.lx, tx, k); cur.ly = lerp(cur.ly, ty, k)
      cur.fx = lerp(cur.fx, cur.lx * 8, k); cur.fy = lerp(cur.fy, cur.ly * 5, k)
      cur.px = lerp(cur.px, cur.lx * 4.5, k * 1.6); cur.py = lerp(cur.py, cur.ly * 4.5, k * 1.6)
      cur.tilt = lerp(cur.tilt, cur.lx * 5, k)
      cur.eye = lerp(cur.eye, m.eye + (near && moodRef.current === 'idle' ? 0.08 : 0), k * 1.4)
      for (const key of ['squint', 'pupil', 'happy', 'browOp'] as const) cur[key] = lerp(cur[key], m[key], k * 1.4)
      for (let i = 0; i < 8; i++) cur.brows[i] = lerp(cur.brows[i], m.brows[i], k * 1.4)

      // Blink on a random rhythm, sometimes twice.
      if (t > st.nextBlink) { st.blinkAt = t; st.nextBlink = t + (Math.random() < 0.2 ? 0.28 : 2 + Math.random() * 3.5) }
      const bp = (t - st.blinkAt) / 0.15, blink = bp < 1 ? 1 - Math.sin(Math.PI * bp) * 0.92 : 1

      // Squash spring, hops and shake.
      st.v += (-190 * st.s - 13 * st.v) * dt; st.s += st.v * dt
      let hy = 0
      if (st.hops > 0 && t > st.hopAt) {
        const p = (t - st.hopAt) / 0.4
        if (p >= 1) { st.hops--; st.hopAt = t + 0.05; impulse(2.4) } else hy = -20 * Math.sin(Math.PI * p)
      }
      const since = t - st.shakeAt, sx = since < 0.55 ? 3.5 * Math.sin(since * 60) * (1 - since / 0.55) : 0
      const breath = reduce ? 0 : Math.sin(t * 2.1 + seed) * 0.018
      const scx = 1 + st.s * 0.6 - breath * 0.5, scy = 1 - st.s + breath

      // Jelly body: squircle points with a slow wobble and a bulge toward the look direction.
      const mag = Math.hypot(cur.lx, cur.ly), pts: [number, number][] = []
      for (let i = 0; i < POINTS; i++) {
        const a = i / POINTS * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
        const wob = reduce ? 0 : 1.5 * Math.sin(t * 1.3 + i * 0.9 + seed) + 0.9 * Math.sin(t * 2.3 + i * 1.7)
        const rr = 1 + (wob + 5 * Math.max(0, c * cur.lx + s * cur.ly) * mag) / 62
        pts.push([CX + RX * superellipse(c) * rr, CY + RY * superellipse(s) * rr])
      }
      el.body.setAttribute('d', smooth(pts))
      el.tail.setAttribute('d', `M60 126 Q60 156 ${f(45 + (reduce ? 0 : Math.sin(t * 1.7 + seed) * 2))} 173 Q70 167 90 146 Z`)

      el.rig.setAttribute('transform', `translate(${f(sx)} ${f(hy)}) rotate(${f(cur.tilt)} 100 ${FOOT}) translate(100 ${FOOT}) scale(${f(scx, 3)} ${f(scy, 3)}) translate(-100 -${FOOT})`)
      el.face.setAttribute('transform', `translate(${f(cur.fx)} ${f(cur.fy)})`)
      el.lids.forEach((lid, i) => {
        const ex = i ? 120 : 80
        lid.setAttribute('transform', `translate(${ex} 92) scale(${f(cur.eye, 3)} ${f(cur.eye * cur.squint * blink, 3)}) translate(-${ex} -92)`)
        lid.setAttribute('opacity', f(1 - cur.happy))
        el.irises[i].setAttribute('transform', `translate(${f(cur.px)} ${f(cur.py)}) translate(${ex} 93) scale(${f(cur.pupil, 3)}) translate(-${ex} -93)`)
      })
      el.happy.forEach((h) => h.setAttribute('opacity', f(cur.happy)))
      el.brows.forEach((line, i) => {
        const o = i * 4
        line.setAttribute('d', `M${f(cur.brows[o])} ${f(cur.brows[o + 1])}L${f(cur.brows[o + 2])} ${f(cur.brows[o + 3])}`)
        line.setAttribute('opacity', f(cur.browOp))
      })
      if (st.mouth !== m.mouth) { st.mouth = m.mouth; el.mouth.setAttribute('d', m.mouth); el.mouth.classList.toggle('filled', m.filled) }
      root.dataset.mood = moodRef.current

      el.shadow.setAttribute('rx', f(54 * scx * (1 + hy / 70), 1))
      el.shadow.setAttribute('opacity', f(1 + hy / 40))
      el.beacon.setAttribute('transform', `translate(${f(cur.fx * 0.5)} ${f((reduce ? 0 : Math.sin(t * 2.2 + seed) * 3) + hy * 0.8)})`)
    }
    frame()

    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerdown', onDown)
      kick.current = () => {}
    }
  }, [])

  return (
    <svg ref={svg} className={`mascot ${className}`} viewBox="0 0 200 200" aria-hidden="true">
      <ellipse className="shadow" cx="100" cy="184" rx="54" ry="7" />
      <g className="rig">
        <path className="tail" />
        <path className="body" />
        <path className="shine" d="M56 78 Q60 56 84 47" />
        <g className="face">
          <path className="brow" /><path className="brow" />
          {[80, 120].map((x) => (
            <g className="lid" key={x}>
              <ellipse className="sclera" cx={x} cy="92" rx="12" ry="14" />
              <g className="iris"><circle className="pupil" cx={x} cy="93" r="7" /><circle className="glint" cx={x + 2.5} cy="90" r="2.2" /></g>
            </g>
          ))}
          <path className="happy-eye" d="M70 96 Q80 83 90 96" opacity="0" />
          <path className="happy-eye" d="M110 96 Q120 83 130 96" opacity="0" />
          <ellipse className="cheek" cx="64" cy="110" rx="8" ry="5" /><ellipse className="cheek" cx="136" cy="110" rx="8" ry="5" />
          <path className="mouth" />
        </g>
      </g>
      <g className="beacon"><circle className="ring" cx="162" cy="36" r="7" /><circle cx="162" cy="36" r="7" /></g>
    </svg>
  )
}
