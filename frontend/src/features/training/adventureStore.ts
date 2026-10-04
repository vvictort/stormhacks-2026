import { useSyncExternalStore } from 'react'
import { emptyAdventure, readAdventure, type Adventure } from './missions.ts'

const snapshots = new Map<string, Adventure>()
const listeners = new Set<() => void>()
const keyFor = (uid: string | null | undefined) => `tellio.adventure.v1.${uid ?? 'guest'}`
export function getAdventure(uid: string | null | undefined): Adventure {
  const key = keyFor(uid)
  if (!snapshots.has(key)) {
    let state: Adventure | null = null
    try { state = readAdventure(localStorage.getItem(key)) } catch { /* Memory works when storage is blocked. */ }
    snapshots.set(key, state ?? emptyAdventure())
  }
  return snapshots.get(key)!
}
export function updateAdventure(uid: string | null | undefined, update: (state: Adventure) => Adventure): Adventure {
  const key = keyFor(uid)
  const previous = getAdventure(uid)
  const state = update(previous)
  if (state === previous) return state
  snapshots.set(key, state)
  try { localStorage.setItem(key, JSON.stringify(state)) } catch { /* Retain the memory copy. */ }
  listeners.forEach(listener => listener())
  return state
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === null) snapshots.clear()
  else if (event.key.startsWith('tellio.adventure.v1.')) snapshots.delete(event.key)
  else return
  listeners.forEach(listener => listener())
})
export function useAdventure(uid: string | null | undefined) {
  return useSyncExternalStore(subscribe, () => getAdventure(uid))
}
