import { useRef } from 'react'

/**
 * A ref that always holds the newest value. The manage modals' debounced
 * writes run 500ms after the change, and read the accessory's state as it is
 * then (as the Angular components read `this.service` at that moment), not
 * as it was in the render that scheduled them.
 * @param value - the value to track
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}
