import {
  LoaderCircle,
  Mic,
  MicOff,
  Phone,
  PhoneMissed,
  PhoneOff,
  Radio,
  RotateCcw,
  ShieldAlert,
  Captions,
  UserRound,
  WifiOff,
} from 'lucide-react'
import { m } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { spring } from '../../../lib/motion'
import { haptic } from '../../../lib/viewTransition'
import type { CallCaption } from '../../../comms/callState'
import type { CallScenario } from '../scenarios'
import { formatDuration, offersPractice, type CallScreen } from './callModel'

/**
 * Call time since this mounted (the moment the call connected), ticking once
 * a second.
 */
function Elapsed() {
  const [since] = useState(() => Date.now())
  const [now, setNow] = useState(since)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span className="call-timer">
      <span className="sr-only">Call time </span>
      {formatDuration((now - since) / 1000)}
    </span>
  )
}

/**
 * `live`: announce status changes. Off for a ticking call timer, which would
 * otherwise be read out every second.
 */
function Caller({
  label,
  number,
  status,
  ringing = false,
  live = true,
}: {
  label: string
  number?: string
  status: ReactNode
  ringing?: boolean
  live?: boolean
}) {
  return (
    <div className="call-caller">
      <span
        className={`call-avatar${ringing ? ' is-ringing' : ''}`}
        aria-hidden="true"
      >
        <UserRound size={34} />
      </span>
      <h2 className="call-name">
        <span className="sr-only">Call from </span>
        {label}
      </h2>
      {number && <p className="call-number">{number}</p>}
      <p className="call-status" role={live ? 'status' : undefined}>
        {status}
      </p>
    </div>
  )
}

function RoundButton({
  kind,
  label,
  icon,
  onClick,
  autoFocus,
}: {
  kind: 'answer' | 'decline' | 'hangup'
  label: string
  icon: ReactNode
  onClick: () => void
  autoFocus?: boolean
}) {
  return (
    <button
      type="button"
      className={`call-round is-${kind}`}
      onClick={() => {
        haptic()
        onClick()
      }}
      autoFocus={autoFocus}
    >
      <span className="call-round-disc" aria-hidden="true">
        {icon}
      </span>
      {label}
    </button>
  )
}

/**
 * Captions, newest last; only the latest few stay on screen. A polite live
 * region reads each new line once.
 */
function CaptionLog({
  captions,
  callerLabel,
}: {
  captions: CallCaption[]
  callerLabel: string
}) {
  const log = useRef<HTMLDivElement>(null)
  const latest = captions.at(-1)?.message
  // Keep the newest line in view as lines arrive or grow, without yanking back
  // on unrelated re-renders.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [captions.length, latest])

  return (
    <div
      ref={log}
      className="call-captions"
      role="log"
      aria-live="polite"
      aria-label="Live captions"
    >
      {captions.length === 0 ? (
        <p className="call-captions-empty">Captions appear here.</p>
      ) : (
        captions.slice(-4).map((caption, i, shown) => (
          <p
            key={captions.length - shown.length + i}
            className={`call-caption is-${caption.role}`}
          >
            <span className="call-caption-who">
              {caption.role === 'agent' ? callerLabel : 'You'}
            </span>
            {caption.message}
          </p>
        ))
      )}
    </div>
  )
}

interface LiveProps {
  scenario: CallScenario
  screen: CallScreen
  callerLabel: string
  captions: CallCaption[]
  agentSpeaking: boolean
  durationSecs?: number
  onStart: () => void
  onAccept: () => void
  onDecline: () => void
  onHangUp: () => void
  onCancel: () => void
  onRetry: () => void
  onPractice: () => void
}

const problem: Partial<
  Record<
    CallScreen,
    { icon: ReactNode; title: string; body: string; retry?: string }
  >
> = {
  mic_denied: {
    icon: <MicOff size={26} />,
    title: 'Microphone blocked',
    body: "The call needs your microphone so you can talk to the caller. Allow it in your browser's address bar, then try again.",
    retry: 'Try again',
  },
  mic_unavailable: {
    icon: <MicOff size={26} />,
    title: 'No microphone found',
    body: "We couldn't use a microphone on this device. Plug one in or close other apps using it, then try again.",
    retry: 'Try again',
  },
  insecure: {
    icon: <ShieldAlert size={26} />,
    title: 'Live calls need a secure page',
    body: 'Browsers only share the microphone on HTTPS or localhost. Open chatisthisreal from a secure address to take live calls.',
  },
  comms_unavailable: {
    icon: <WifiOff size={26} />,
    title: "Live voice isn't available",
    body: "We couldn't reach the call service, so this call can't ring right now.",
    retry: 'Try again',
  },
  voice_unavailable: {
    icon: <Radio size={26} />,
    title: "Live voice isn't available",
    body: "The AI voice for practice calls isn't set up or isn't responding right now.",
  },
  not_connected: {
    icon: <PhoneOff size={26} />,
    title: "The call didn't connect",
    body: "The voice line never came through, so this call doesn't count either way.",
    retry: 'Ring me again',
  },
  failed: {
    icon: <PhoneOff size={26} />,
    title: 'The call dropped',
    body: 'Something went wrong with this call before it could finish.',
    retry: 'Ring me again',
  },
}

function endedStatus(screen: CallScreen, durationSecs?: number): ReactNode {
  if (screen === 'declined') return 'Call declined'
  if (screen === 'missed') {
    return (
      <>
        <PhoneMissed size={15} aria-hidden="true" /> Missed call
      </>
    )
  }
  const duration = durationSecs ? ` · ${formatDuration(durationSecs)}` : ''
  return `Call ended${duration}`
}

/**
 * The phone's call app for a live (voiced) call. One screen per call state;
 * see callModel.callScreen.
 */
export function LiveCallScreen(props: LiveProps) {
  const { scenario, screen, callerLabel } = props
  const info = problem[screen]

  if (info) {
    return (
      <div className="call-screen is-problem">
        <span className="call-problem-icon" aria-hidden="true">
          {info.icon}
        </span>
        <h2 className="call-problem-title">{info.title}</h2>
        <p className="call-problem-body">{info.body}</p>
        {offersPractice(screen) && (
          <p className="call-problem-body">
            You can still practise this call with captions instead of a voice.
          </p>
        )}
        <div className="call-problem-actions">
          {/* The focused button (Answer) is gone with the old screen: put focus
              on the way forward. */}
          {info.retry && (
            <button
              type="button"
              className="call-pill is-light"
              onClick={props.onRetry}
              autoFocus
            >
              <RotateCcw size={16} aria-hidden="true" />
              {info.retry}
            </button>
          )}
          {offersPractice(screen) && (
            <button
              type="button"
              className="call-pill"
              onClick={props.onPractice}
              autoFocus={!info.retry}
            >
              <Captions size={16} aria-hidden="true" />
              Practise with captions
            </button>
          )}
        </div>
      </div>
    )
  }

  switch (screen) {
    case 'idle':
      return (
        <div className="call-screen is-idle">
          <p className="call-lock-time" aria-hidden="true">
            {new Date()
              .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
              .replace(/\s?[AP]M$/i, '')}
          </p>
          <p className="call-idle-text">
            When you're ready, this phone will ring. Answer it or not, the way
            you would on your own phone.
          </p>
          <button type="button" className="call-pill" onClick={props.onStart}>
            <Phone size={16} aria-hidden="true" />
            I'm ready, ring me
          </button>
        </div>
      )
    case 'starting':
      return (
        <div className="call-screen is-idle">
          <p className="call-status" role="status">
            <LoaderCircle size={18} className="spinner" aria-hidden="true" />{' '}
            Waiting for the call…
          </p>
        </div>
      )
    case 'ringing':
      return (
        <div className="call-screen">
          <p className="call-chip">Practice call</p>
          <Caller
            label={callerLabel}
            number={scenario.callerNumber}
            status="Incoming call…"
            ringing
          />
          <div className="call-actions">
            <RoundButton
              kind="decline"
              label="Decline"
              icon={<PhoneOff size={26} />}
              onClick={props.onDecline}
            />
            <RoundButton
              kind="answer"
              label="Answer"
              icon={<Phone size={26} />}
              onClick={props.onAccept}
              autoFocus
            />
          </div>
        </div>
      )
    case 'connecting':
      return (
        <div className="call-screen">
          <Caller
            label={callerLabel}
            number={scenario.callerNumber}
            status={
              <>
                <LoaderCircle
                  size={16}
                  className="spinner"
                  aria-hidden="true"
                />{' '}
                Connecting…
              </>
            }
          />
          <p className="call-mic-note">
            <Mic size={16} aria-hidden="true" />
            If your browser asks, allow the microphone. chatisthisreal only uses
            it during this practice call.
          </p>
          <div className="call-actions is-single">
            <RoundButton
              kind="hangup"
              label="Cancel"
              icon={<PhoneOff size={26} />}
              onClick={props.onCancel}
            />
          </div>
        </div>
      )
    case 'active':
      return (
        <div className="call-screen is-active">
          <Caller label={callerLabel} status={<Elapsed />} live={false} />
          <p
            className={`call-speaking${props.agentSpeaking ? ' is-on' : ''}`}
            aria-hidden="true"
          >
            <span className="call-bars">
              <i />
              <i />
              <i />
              <i />
            </span>
            {props.agentSpeaking ? 'Caller speaking' : 'Listening'}
          </p>
          <CaptionLog captions={props.captions} callerLabel={callerLabel} />
          <div className="call-actions is-single">
            <RoundButton
              kind="hangup"
              label="Hang up"
              icon={<PhoneOff size={26} />}
              onClick={props.onHangUp}
              autoFocus
            />
          </div>
        </div>
      )
    case 'analyzing':
      return (
        <div className="call-screen is-ended">
          <Caller label={callerLabel} status="Call ended" />
          <p className="call-analyzing" role="status">
            <LoaderCircle size={18} className="spinner" aria-hidden="true" />
            Checking how the call went…
          </p>
        </div>
      )
    case 'declined':
    case 'missed':
    case 'ended':
    default:
      return (
        <div className="call-screen is-ended">
          <Caller
            label={callerLabel}
            status={endedStatus(screen, props.durationSecs)}
          />
        </div>
      )
  }
}

const LINE_MS = 3200

/**
 * Caption-only practice: the local script plays as captions; the user hangs up
 * or does what the caller asks.
 */
export function PracticeCallScreen({
  scenario,
  onDone,
  done,
}: {
  scenario: CallScenario
  onDone: (action: 'hang_up' | 'comply') => void
  done: boolean
}) {
  const [shown, setShown] = useState(1)
  const total = scenario.practice.lines.length

  useEffect(() => {
    if (done || shown >= total) return
    const timer = window.setTimeout(
      () => setShown((count) => count + 1),
      LINE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [done, shown, total])

  const captions = scenario.practice.lines
    .slice(0, shown)
    .map((message) => ({ role: 'agent' as const, message }))

  if (done) {
    return (
      <div className="call-screen is-ended">
        <p className="call-chip">Caption-only practice</p>
        <Caller label={scenario.callerLabel} status="Call ended" />
      </div>
    )
  }

  return (
    <div className="call-screen is-active">
      <p className="call-chip">Caption-only practice · no live voice</p>
      <Caller label={scenario.callerLabel} status={<Elapsed />} live={false} />
      <CaptionLog captions={captions} callerLabel={scenario.callerLabel} />
      <m.div
        className="call-practice-actions"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <button
          type="button"
          className="call-pill is-light"
          onClick={() => onDone('comply')}
        >
          {scenario.practice.complyLabel}
        </button>
        <RoundButton
          kind="hangup"
          label="Hang up"
          icon={<PhoneOff size={26} />}
          onClick={() => onDone('hang_up')}
        />
      </m.div>
    </div>
  )
}
