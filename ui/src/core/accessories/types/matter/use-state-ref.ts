import { useCallback, useRef, useState } from 'react'

/**
 * State that the manage modals' debounced writes and catch blocks can read
 * and write after the render they were created in, the way the Angular
 * components read `this.targetX.value` when the debounce fired: the value
 * (for rendering), a setter, and a ref that always holds the newest value.
 * @param initial - the initial value, or a function returning it
 */
export function useStateRef<T>(initial: T | (() => T)) {
  const [value, setValue] = useState(initial)
  const ref = useRef(value)
  const set = useCallback((next: T) => {
    ref.current = next
    setValue(next)
  }, [])
  return [value, set, ref] as const
}
