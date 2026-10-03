import { useRef } from 'react'

/**
 * A ref that always holds the newest value, so a callback or an effect that
 * runs once (a debounced write, a terminal set up at mount) reads the value as
 * it is when it runs, not as it was in the render that created it.
 * @param value - the value to track
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}
