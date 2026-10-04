// A phone-like spring: quick, settled, a hint of overshoot.
export const spring = {
  type: 'spring',
  stiffness: 420,
  damping: 32,
  mass: 0.9,
} as const

// Motion's animation features load in their own chunk, after first paint (see <LazyMotion> in App).
export const loadMotionFeatures = () =>
  import('./motionFeatures').then((module) => module.default)
