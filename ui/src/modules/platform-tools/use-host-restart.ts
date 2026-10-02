import type { HomebridgeStatusResponse } from '@/core/interfaces/server.interfaces'

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { ws } from '@/core/ws'

export interface HostRestartOptions {
  /** The PUT that starts the restart */
  endpoint: string
  /** How long the old process may still answer before status events are believed */
  settleMs: number
  /** When to warn that it is taking too long */
  timeoutMs: number
  /** i18n keys */
  successKey: string
  errorKey: string
  timeoutKey: string
}

/**
 * The shared behaviour of the container and host restart pages (the Angular
 * components carried a copy each): start the restart, then wait for the
 * `status` socket to report Homebridge up.
 *
 * The `status` namespace is shared and cached, and `io.end()` deliberately
 * leaves listeners in place, so the handler is detached by reference on
 * unmount. Without that, leaving the page before the machine is back orphans
 * the closure, and a later `homebridge-status` event toasts and navigates the
 * user home from an unrelated page.
 * @param options - the endpoint, timings and messages of one page
 */
export function useHostRestart(options: HostRestartOptions): { error: string | false, timedOut: boolean } {
  const navigate = useNavigate()
  const [error, setError] = useState<string | false>(false)
  const [timedOut, setTimedOut] = useState(false)

  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const optionsRef = useRef(options)
  // The restart request is sent once per page, even though StrictMode runs the
  // effect twice; every effect run waits on the same request
  const restartRef = useRef<Promise<unknown> | null>(null)

  useEffect(() => {
    const { endpoint, settleMs, timeoutMs, successKey, errorKey, timeoutKey } = optionsRef.current
    const io = ws.connectToNamespace('status')
    let disposed = false
    let statusCheckActive = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let warningTimer: ReturnType<typeof setTimeout> | undefined

    // Subscribe for reconnections, for as long as the page is open
    const unsubscribeConnected = io.connected.subscribe(() => {
      io.socket.emit('monitor-server-status')
      settingsActions.getAppSettings().catch(() => { /* do nothing */ })
    })

    const statusHandler = (data: HomebridgeStatusResponse) => {
      if (!statusCheckActive) {
        return
      }
      if (data.status === 'ok' || data.status === 'pending') {
        // Latch so further `homebridge-status` events don't re-toast while
        // router navigation is in flight (screen readers re-read)
        statusCheckActive = false
        toast.success(i18n.t(successKey), i18n.t('toast.title_success'))
        void navigateRef.current('/')
      }
    }

    // Set up socket listener for homebridge status updates
    io.socket.on('homebridge-status', statusHandler)

    const checkIfServerUp = () => {
      settleTimer = setTimeout(() => {
        // Activate status checking - the socket listener will now respond to events
        statusCheckActive = true
        // Request a fresh status in case it came back quickly and we missed the initial event
        io.socket.emit('monitor-server-status')
      }, settleMs)

      warningTimer = setTimeout(() => {
        toast.warning(i18n.t(timeoutKey), i18n.t('toast.title_warning'), { timeOut: 10000 })
        setTimedOut(true)
      }, timeoutMs)
    }

    void (async () => {
      restartRef.current ??= api.put(endpoint, {})
      try {
        await restartRef.current
        if (!disposed) {
          checkIfServerUp()
        }
      } catch (restartError) {
        if (disposed) {
          return
        }
        console.error(restartError)
        setError(i18n.t(errorKey))
        toast.error(i18n.t(errorKey), i18n.t('toast.title_error'))
      }
    })()

    return () => {
      disposed = true
      statusCheckActive = false
      clearTimeout(settleTimer)
      clearTimeout(warningTimer)
      unsubscribeConnected()
      io.socket.off('homebridge-status', statusHandler)
      io.end()
    }
  }, [])

  return { error, timedOut }
}
