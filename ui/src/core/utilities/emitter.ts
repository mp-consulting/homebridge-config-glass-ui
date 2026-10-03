/** A plain listener set: the part of an rxjs `Subject` the app's stores use. */
export interface Emitter<T = void> {
  /** Add a listener. Returns the unsubscribe. */
  subscribe: (listener: (value: T) => void) => () => void
  /** Call every listener. A snapshot, so a listener may unsubscribe (or subscribe) while being called. */
  emit: (value: T) => void
  /** Drop every listener. */
  clear: () => void
}

/** A typed listener set. Its methods are plain functions, safe to pass around unbound. */
export function createEmitter<T = void>(): Emitter<T> {
  const listeners = new Set<(value: T) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(value) {
      for (const listener of Array.from(listeners)) {
        listener(value)
      }
    },
    clear() {
      listeners.clear()
    },
  }
}
