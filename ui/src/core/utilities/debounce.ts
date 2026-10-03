import { useEffect, useState } from 'react'

import { useLatest } from '@/core/hooks/use-latest'

export interface Debounced<A extends unknown[]> {
  (...args: A): void
  /** Drop the pending call, if any. */
  cancel: () => void
}

/**
 * A trailing debounce, the plain-timer equivalent of rxjs `debounceTime`.
 * `cancel()` drops a pending call (the `takeUntil(destroy$)` half).
 * @param fn - the function to call once the calls stop
 * @param ms - how long the calls must stop for
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: A) => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, ms)
  }
  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  return debounced
}

/**
 * `debounce` for a component: a stable function that calls the newest `fn`
 * `ms` after the last call, and drops a pending call on unmount. `ms` is read
 * once.
 * @param fn - the function to call once the calls stop
 * @param ms - how long the calls must stop for
 */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  const latest = useLatest(fn)
  const [debounced] = useState(() => debounce((...args: A) => latest.current(...args), ms))
  useEffect(() => () => debounced.cancel(), [debounced])
  return debounced
}
