import { useEffect, useRef } from 'react'
import { create } from 'zustand'

/**
 * App-wide notification state, ported from NotificationService (three signals).
 *
 * - `raspberryPiThrottled`: the under-voltage / throttling flags the `app`
 *   namespace reports, read by the sidebar and the status page.
 * - `formAuthEnabled`: whether the UI has a login (null until known).
 * - `legacyOtpDetected`: the signed-in user still has the old two-factor
 *   secret format; set by the auth store, cleared once 2FA is re-done.
 */
export interface NotificationState {
  raspberryPiThrottled: Record<string, boolean>
  formAuthEnabled: boolean | null
  legacyOtpDetected: boolean
}

export type NotificationKey = keyof NotificationState

export function initialNotificationState(): NotificationState {
  return {
    raspberryPiThrottled: {},
    formAuthEnabled: null,
    legacyOtpDetected: false,
  }
}

export const useNotificationStore = create<NotificationState>()(() => initialNotificationState())

export const notifications = {
  get<K extends NotificationKey>(key: K): NotificationState[K] {
    return useNotificationStore.getState()[key]
  },

  set<K extends NotificationKey>(key: K, value: NotificationState[K]): void {
    useNotificationStore.setState({ [key]: value } as Pick<NotificationState, K>)
  },

  /**
   * Call `handler` whenever one value changes. Returns the unsubscribe.
   * @param key - the value to watch
   * @param handler - receives the new and previous value
   */
  subscribe<K extends NotificationKey>(key: K, handler: (value: NotificationState[K], previous: NotificationState[K]) => void): () => void {
    return useNotificationStore.subscribe((state, previous) => {
      if (state[key] !== previous[key]) {
        handler(state[key], previous[key])
      }
    })
  },

  /** Put every value back to its start. For specs. */
  reset(): void {
    useNotificationStore.setState(initialNotificationState(), true)
  },
}

/**
 * Read one notification value in a component, re-rendering when it changes.
 * With a `handler`, also calls it on every change (the effect cleans up).
 * @param key - the value to read
 * @param handler - optional change callback
 */
export function useNotification<K extends NotificationKey>(key: K, handler?: (value: NotificationState[K]) => void): NotificationState[K] {
  const value = useNotificationStore(state => state[key])
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!handlerRef.current) {
      return undefined
    }
    return notifications.subscribe(key, next => handlerRef.current?.(next))
  }, [key])

  return value
}
