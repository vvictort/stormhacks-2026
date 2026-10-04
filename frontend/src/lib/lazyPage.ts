import { createElement, lazy, type ComponentType } from 'react'

const preloaders: (() => Promise<unknown>)[] = []

/**
 * A route page in its own chunk. Unlike a bare React.lazy, it renders synchronously once its chunk has loaded, so a
 * View Transition's flushSync navigation (lib/viewTransition) never commits a Suspense fallback for a loaded page.
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  let Loaded: ComponentType<P> | null = null
  let loading: Promise<ComponentType<P>> | null = null
  const preload = () => (loading ??= load().then((page) => (Loaded = page)))
  const Pending = lazy(() => preload().then((page) => ({ default: page })))
  preloaders.push(preload)
  return (props: P) => createElement(Loaded ?? Pending, props)
}

/** Loads every page chunk. TransitionLink waits for it, so an animated navigation always lands on a ready page. */
export const preloadPages = () => Promise.all(preloaders.map((preload) => preload()))
