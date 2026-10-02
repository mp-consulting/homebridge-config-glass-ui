import { useSyncExternalStore } from 'react'

/**
 * A boolean the lightbulb tile keeps up to date and its manage modal reads
 * live (Angular handed the modal the tile's `isAdaptiveLightingEnabled`
 * signal). The modal is rendered by the modal host, outside the tile, so it
 * cannot just take the value as a prop.
 */
export interface AdaptiveLightingSignal {
  get: () => boolean
  set: (value: boolean) => void
  subscribe: (listener: () => void) => () => void
}

export function createAdaptiveLightingSignal(initial: boolean): AdaptiveLightingSignal {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (next !== value) {
        value = next
        listeners.forEach(listener => listener())
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const noSignal = {
  get: () => false,
  subscribe: () => () => {},
}

/**
 * The current value of a signal, re-rendering when it changes.
 * @param signal - the signal, or undefined for a bulb without adaptive lighting
 */
export function useAdaptiveLighting(signal: AdaptiveLightingSignal | undefined): boolean {
  const source = signal ?? noSignal
  return useSyncExternalStore(source.subscribe, source.get, source.get)
}
