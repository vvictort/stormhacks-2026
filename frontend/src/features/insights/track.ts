import { api } from '../../lib/api'
import { createTracker } from './tracker'

/** The app's behaviour tracker. A failed send is dropped silently: tracking never gets in the user's way. */
export const tracker = createTracker((events, keepalive) =>
  api('/training/events', {
    method: 'POST',
    body: JSON.stringify({ events }),
    keepalive,
  }),
)

// Leaving or hiding the page: send what's queued, surviving the unload.
window.addEventListener('pagehide', () => void tracker.flush(true))
