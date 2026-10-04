import { useEffect, useRef } from 'react'
import './Mascot.css'

export type MascotMood = 'idle' | 'curious' | 'suspicious' | 'alert' | 'happy'

interface Pose {
  eye: number
  squint: number
  pupil: number
  happy: number
  browOp: number
  brows: number[]
  mouth: string
  filled: boolean
}

// Each mood is a set of targets the rig eases toward.
const MOODS: Record<MascotMood, Pose> = {
  idle: {
    eye: 1,
    squint: 1,
    pupil: 1,
    happy: 0,
    browOp: 0,
    brows: [68, 72, 88, 70, 112, 70, 132, 72],
    mouth: 'M90 114 Q100 122 110 114',
    filled: false,
  },
  curious: {
    eye: 1.14,
    squint: 1,
    pupil: 1.12,
    happy: 0,
    browOp: 1,
    brows: [68, 68, 88, 65, 112, 65, 132, 68],
    mouth: 'M95 117 Q100 120 105 117',
    filled: false,
  },
  suspicious: {
    eye: 1,
    squint: 0.4,
    pupil: 1,
    happy: 0,
    browOp: 1,
    brows: [68, 79, 90, 84, 111, 74, 132, 69],
    mouth: 'M90 118 Q95 114 100 118 Q105 122 110 117',
    filled: false,
  },
  alert: {
    eye: 1.2,
    squint: 1,
    pupil: 0.68,
    happy: 0,
    browOp: 1,
    brows: [67, 66, 87, 61, 113, 61, 133, 66],
    mouth:
      'M100 110 C104.5 110 106.5 113.5 106.5 117.5 C106.5 121.5 104 124 100 124 C96 124 93.5 121.5 93.5 117.5 C93.5 113.5 95.5 110 100 110 Z',
    filled: true,
  },
  happy: {
    eye: 1,
    squint: 1,
    pupil: 1,
    happy: 1,
    browOp: 0,
    brows: [68, 72, 88, 70, 112, 70, 132, 72],
    mouth: 'M87 111 Q100 115 113 111 Q111 127 100 127 Q89 127 87 111 Z',
    filled: true,
  },
}

// The body is a squircle centred on (BODY_X, BODY_Y); the rig squashes and
// tilts about the foot.
const BODY_X = 100
const BODY_Y = 96
const BODY_RADIUS_X = 66
const BODY_RADIUS_Y = 58
const BODY_POINTS = 22
const FOOT_Y = 154

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount
const superellipse = (c: number) => Math.sign(c) * Math.abs(c) ** 0.78
const fixed = (value: number, digits = 2) => value.toFixed(digits)

/** An SVG transform that scales about the point (x, y). */
const scaleAbout = (x: number, y: number, scale: string) =>
  `translate(${x} ${y}) scale(${scale}) translate(-${x} -${y})`

// Closed Catmull-Rom spline through the points, as cubic Béziers.
function smooth(points: [number, number][]) {
  const count = points.length
  let path = `M${fixed(points[0][0], 1)} ${fixed(points[0][1], 1)}`
  for (let i = 0; i < count; i++) {
    const before = points[(i - 1 + count) % count]
    const from = points[i]
    const to = points[(i + 1) % count]
    const after = points[(i + 2) % count]
    const curve = [
      from[0] + (to[0] - before[0]) / 6,
      from[1] + (to[1] - before[1]) / 6,
      to[0] - (after[0] - from[0]) / 6,
      to[1] - (after[1] - from[1]) / 6,
      to[0],
      to[1],
    ]
    path += `C${curve.map((n) => fixed(n, 1)).join(' ')}`
  }
  return path + 'Z'
}

/**
 * Jelly body: squircle points with a slow wobble and a bulge toward the look
 * direction.
 */
function bodyPath(
  time: number,
  seed: number,
  lookX: number,
  lookY: number,
  reduce: boolean,
) {
  const lookAmount = Math.hypot(lookX, lookY)
  const points: [number, number][] = []
  for (let i = 0; i < BODY_POINTS; i++) {
    const angle = (i / BODY_POINTS) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const wobble = reduce
      ? 0
      : 1.5 * Math.sin(time * 1.3 + i * 0.9 + seed) +
        0.9 * Math.sin(time * 2.3 + i * 1.7)
    const bulge = 5 * Math.max(0, cos * lookX + sin * lookY) * lookAmount
    const radius = 1 + (wobble + bulge) / 62
    points.push([
      BODY_X + BODY_RADIUS_X * superellipse(cos) * radius,
      BODY_Y + BODY_RADIUS_Y * superellipse(sin) * radius,
    ])
  }
  return smooth(points)
}

/**
 * Tell, the speech-bubble mascot. Decorative: it follows the pointer, blinks,
 * and acts out `mood`.
 */
export function Mascot({
  mood = 'idle',
  className = '',
}: {
  mood?: MascotMood
  className?: string
}) {
  const svg = useRef<SVGSVGElement>(null)
  const moodRef = useRef(mood)
  const kick = useRef<(m: MascotMood) => void>(() => {})

  useEffect(() => {
    moodRef.current = mood
    kick.current(mood)
  }, [mood])

  useEffect(() => {
    const root = svg.current!
    const one = (selector: string) => root.querySelector(selector) as SVGElement
    const all = (selector: string) =>
      [...root.querySelectorAll(selector)] as SVGElement[]
    const parts = {
      rig: one('.rig'),
      body: one('.body'),
      tail: one('.tail'),
      face: one('.face'),
      lids: all('.lid'),
      irises: all('.iris'),
      happyEyes: all('.happy-eye'),
      brows: all('.brow'),
      mouth: one('.mouth'),
      shadow: one('.shadow'),
      beacon: one('.beacon'),
    }

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const seed = Math.random() * 100
    const now = () => performance.now() / 1000
    const pointer = { x: 0, y: 0, at: -1e9 }
    const start = MOODS[moodRef.current]
    // What is drawn: it eases toward the mood's pose and the look direction.
    const pose = {
      ...start,
      brows: [...start.brows],
      faceX: 0,
      faceY: 0,
      pupilX: 0,
      pupilY: 0,
      tilt: 0,
      lookX: 0,
      lookY: 0,
    }
    const motion = {
      squash: 0,
      squashSpeed: 0,
      hops: 0,
      hopAt: 0,
      shakeAt: -9,
      blinkAt: -9,
      nextBlink: 1 + Math.random() * 2,
      wander: { x: 0, y: 0, at: 0 },
      mouth: '',
    }
    const impulse = (speed: number) => {
      if (!reduce) motion.squashSpeed += speed
    }

    kick.current = (next) => {
      const time = now()
      if (next === 'happy' && !reduce) {
        motion.hops = 2
        motion.hopAt = time + 0.1
        impulse(1.6)
      } else if (next === 'alert') {
        if (!reduce) motion.shakeAt = time
        impulse(1.2)
      } else {
        impulse(0.8)
      }
    }

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointer.at = performance.now()
    }
    const onDown = () => impulse(3.2)
    addEventListener('pointermove', onMove, { passive: true })
    root.addEventListener('pointerdown', onDown)

    const draw = (
      time: number,
      target: Pose,
      frame: {
        blink: number
        hopY: number
        shakeX: number
        scaleX: number
        scaleY: number
      },
    ) => {
      const { blink, hopY, shakeX, scaleX, scaleY } = frame

      parts.body.setAttribute(
        'd',
        bodyPath(time, seed, pose.lookX, pose.lookY, reduce),
      )
      const tailSway = reduce ? 0 : Math.sin(time * 1.7 + seed) * 2
      parts.tail.setAttribute(
        'd',
        `M60 126 Q60 156 ${fixed(45 + tailSway)} 173 Q70 167 90 146 Z`,
      )

      parts.rig.setAttribute(
        'transform',
        [
          `translate(${fixed(shakeX)} ${fixed(hopY)})`,
          `rotate(${fixed(pose.tilt)} 100 ${FOOT_Y})`,
          scaleAbout(100, FOOT_Y, `${fixed(scaleX, 3)} ${fixed(scaleY, 3)}`),
        ].join(' '),
      )
      parts.face.setAttribute(
        'transform',
        `translate(${fixed(pose.faceX)} ${fixed(pose.faceY)})`,
      )

      parts.lids.forEach((lid, i) => {
        const eyeX = i ? 120 : 80
        const openness = fixed(pose.eye * pose.squint * blink, 3)
        lid.setAttribute(
          'transform',
          scaleAbout(eyeX, 92, `${fixed(pose.eye, 3)} ${openness}`),
        )
        lid.setAttribute('opacity', fixed(1 - pose.happy))
        parts.irises[i].setAttribute(
          'transform',
          [
            `translate(${fixed(pose.pupilX)} ${fixed(pose.pupilY)})`,
            scaleAbout(eyeX, 93, fixed(pose.pupil, 3)),
          ].join(' '),
        )
      })
      parts.happyEyes.forEach((eye) =>
        eye.setAttribute('opacity', fixed(pose.happy)),
      )
      parts.brows.forEach((line, i) => {
        const [x1, y1, x2, y2] = pose.brows
          .slice(i * 4, i * 4 + 4)
          .map((n) => fixed(n))
        line.setAttribute('d', `M${x1} ${y1}L${x2} ${y2}`)
        line.setAttribute('opacity', fixed(pose.browOp))
      })
      if (motion.mouth !== target.mouth) {
        motion.mouth = target.mouth
        parts.mouth.setAttribute('d', target.mouth)
        parts.mouth.classList.toggle('filled', target.filled)
      }
      root.dataset.mood = moodRef.current

      parts.shadow.setAttribute('rx', fixed(54 * scaleX * (1 + hopY / 70), 1))
      parts.shadow.setAttribute('opacity', fixed(1 + hopY / 40))
      const beaconBob = reduce ? 0 : Math.sin(time * 2.2 + seed) * 3
      parts.beacon.setAttribute(
        'transform',
        `translate(${fixed(pose.faceX * 0.5)} ${fixed(beaconBob + hopY * 0.8)})`,
      )
    }

    let raf = 0
    let prev = now()
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const time = now()
      const dt = Math.min(0.05, time - prev)
      prev = time
      const rect = root.getBoundingClientRect()
      // Hidden, e.g. the editorial column on small screens.
      if (!rect.width) return

      const target = MOODS[moodRef.current]
      const ease = 1 - Math.exp(-dt * 9)
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height * 0.47
      const tracking = performance.now() - pointer.at < 2600
      // Where to look: the pointer if it moved recently, otherwise glance
      // around.
      let lookX: number
      let lookY: number
      if (tracking) {
        const dx = pointer.x - centerX
        const dy = pointer.y - centerY
        const distance = Math.hypot(dx, dy) || 1
        const strength = Math.min(1, distance / (rect.width * 0.9 + 40))
        lookX = (dx / distance) * strength
        lookY = (dy / distance) * strength
      } else {
        if (time > motion.wander.at) {
          const angle = Math.random() * Math.PI * 2
          const reach = Math.random() < 0.3 ? 0 : 0.5 + Math.random() * 0.5
          motion.wander = {
            x: Math.cos(angle) * reach,
            y: Math.sin(angle) * reach * 0.6,
            at: time + 1.2 + Math.random() * 2,
          }
        }
        lookX = motion.wander.x
        lookY = motion.wander.y
      }

      const near =
        tracking &&
        Math.hypot(pointer.x - centerX, pointer.y - centerY) < rect.width * 0.7
      pose.lookX = lerp(pose.lookX, lookX, ease)
      pose.lookY = lerp(pose.lookY, lookY, ease)
      pose.faceX = lerp(pose.faceX, pose.lookX * 8, ease)
      pose.faceY = lerp(pose.faceY, pose.lookY * 5, ease)
      pose.pupilX = lerp(pose.pupilX, pose.lookX * 4.5, ease * 1.6)
      pose.pupilY = lerp(pose.pupilY, pose.lookY * 4.5, ease * 1.6)
      pose.tilt = lerp(pose.tilt, pose.lookX * 5, ease)
      pose.eye = lerp(
        pose.eye,
        target.eye + (near && moodRef.current === 'idle' ? 0.08 : 0),
        ease * 1.4,
      )
      for (const key of ['squint', 'pupil', 'happy', 'browOp'] as const) {
        pose[key] = lerp(pose[key], target[key], ease * 1.4)
      }
      for (let i = 0; i < 8; i++) {
        pose.brows[i] = lerp(pose.brows[i], target.brows[i], ease * 1.4)
      }

      // Blink on a random rhythm, sometimes twice.
      if (time > motion.nextBlink) {
        motion.blinkAt = time
        motion.nextBlink =
          time + (Math.random() < 0.2 ? 0.28 : 2 + Math.random() * 3.5)
      }
      const blinkPhase = (time - motion.blinkAt) / 0.15
      const blink =
        blinkPhase < 1 ? 1 - Math.sin(Math.PI * blinkPhase) * 0.92 : 1

      // Squash spring, hops and shake.
      motion.squashSpeed +=
        (-190 * motion.squash - 13 * motion.squashSpeed) * dt
      motion.squash += motion.squashSpeed * dt
      let hopY = 0
      if (motion.hops > 0 && time > motion.hopAt) {
        const progress = (time - motion.hopAt) / 0.4
        if (progress >= 1) {
          motion.hops--
          motion.hopAt = time + 0.05
          impulse(2.4)
        } else {
          hopY = -20 * Math.sin(Math.PI * progress)
        }
      }
      const sinceShake = time - motion.shakeAt
      const shakeX =
        sinceShake < 0.55
          ? 3.5 * Math.sin(sinceShake * 60) * (1 - sinceShake / 0.55)
          : 0
      const breath = reduce ? 0 : Math.sin(time * 2.1 + seed) * 0.018
      const scaleX = 1 + motion.squash * 0.6 - breath * 0.5
      const scaleY = 1 - motion.squash + breath

      draw(time, target, { blink, hopY, shakeX, scaleX, scaleY })
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
    <svg
      ref={svg}
      className={`mascot ${className}`}
      viewBox="0 0 200 200"
      aria-hidden="true"
    >
      <ellipse className="shadow" cx="100" cy="184" rx="54" ry="7" />
      <g className="rig">
        <path className="tail" />
        <path className="body" />
        <path className="shine" d="M56 78 Q60 56 84 47" />
        <g className="face">
          <path className="brow" />
          <path className="brow" />
          {[80, 120].map((x) => (
            <g className="lid" key={x}>
              <ellipse className="sclera" cx={x} cy="92" rx="12" ry="14" />
              <g className="iris">
                <circle className="pupil" cx={x} cy="93" r="7" />
                <circle className="glint" cx={x + 2.5} cy="90" r="2.2" />
              </g>
            </g>
          ))}
          <path className="happy-eye" d="M70 96 Q80 83 90 96" opacity="0" />
          <path className="happy-eye" d="M110 96 Q120 83 130 96" opacity="0" />
          <ellipse className="cheek" cx="64" cy="110" rx="8" ry="5" />
          <ellipse className="cheek" cx="136" cy="110" rx="8" ry="5" />
          <path className="mouth" />
        </g>
      </g>
      <g className="beacon">
        <circle className="ring" cx="162" cy="36" r="7" />
        <circle cx="162" cy="36" r="7" />
      </g>
    </svg>
  )
}
