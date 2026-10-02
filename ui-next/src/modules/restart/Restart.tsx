import type { HomebridgeStatusResponse } from '@/core/interfaces/server.interfaces'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'

import { api } from '@/core/api'
import { ttlCache } from '@/core/caching'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { ws } from '@/core/ws'

import './restart.scss'

interface RestartResponse extends Record<string, unknown> {
  restartingUI?: boolean
  command?: string
}

/**
 * The restart page: asks the server to restart (unless something else already
 * did), then waits for the `status` socket to come back and report Homebridge
 * up. It cannot poll, because the UI itself may be restarting too.
 */
export function Restart() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [uiOnline, setUiOnline] = useState(false)
  const [error, setError] = useState<string | false>(false)
  const [resp, setResp] = useState<RestartResponse>({})
  const [timedOut, setTimedOut] = useState(false)

  const uiIcon = uiOnline ? 'far fa-check-circle' : 'fas fa-circle-notch fa-spin'
  const serviceIcon = uiOnline ? 'fas fa-circle-notch fa-spin' : 'far fa-circle'

  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  // Read once, at mount, like the Angular ngOnInit
  const queryRef = useRef(searchParams)
  // The restart request is sent once per page, even though StrictMode runs the
  // effect twice; every effect run waits on the same request
  const restartRef = useRef<Promise<RestartResponse> | null>(null)

  useEffect(() => {
    const io = ws.connectToNamespace('status')
    let disposed = false
    let statusCheckActive = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let warningTimer: ReturnType<typeof setTimeout> | undefined

    // Subscribe for reconnections. Bound to the component lifecycle - the user
    // can navigate away before the reconnect arrives (closing the restart tab
    // mid-restart)
    const unsubscribeConnected = io.connected.subscribe(() => {
      io.socket.emit('monitor-server-status')
      settingsActions.getAppSettings().catch(() => { /* do nothing */ })
    })

    const handleHomebridgeStatus = (data: HomebridgeStatusResponse) => {
      if (statusCheckActive) {
        setUiOnline(true)
        if (data.status === 'ok' || data.status === 'pending') {
          // Latch so further `homebridge-status` events don't re-toast while
          // router navigation is in flight (screen readers re-read)
          statusCheckActive = false
          toast.success(i18n.t('restart.toast_server_restarted'), i18n.t('toast.title_success'))
          void navigateRef.current('/')
        }
      }
    }
    io.socket.on('homebridge-status', handleHomebridgeStatus)

    const checkIfServerUp = () => {
      // Activate status checking - the socket listener will now respond to events
      settleTimer = setTimeout(() => {
        statusCheckActive = true
        // Request a fresh status in case the server restarted quickly and we missed the initial event
        io.socket.emit('monitor-server-status')
      }, 7000)

      // Set up timeout warning
      warningTimer = setTimeout(() => {
        toast.warning(i18n.t('restart.toast_server_restart_timeout'), i18n.t('toast.title_warning'), { timeOut: 10000 })
        setTimedOut(true)
      }, 40000)
    }

    const performRestart = async () => {
      restartRef.current ??= api.put<RestartResponse>('/server/restart', {}).then((data) => {
        ttlCache.invalidateAll()
        return data
      })
      try {
        const data = await restartRef.current
        if (disposed) {
          return
        }
        setResp(data ?? {})
        checkIfServerUp()
        if (!data?.restartingUI) {
          setUiOnline(true)
        }
      } catch (restartError) {
        if (disposed) {
          return
        }
        console.error(restartError)
        setError(i18n.t('restart.toast_server_restart_error'))
        toast.error(i18n.t('restart.toast_server_restart_error'), i18n.t('toast.title_error'))
      }
    }

    // Some custom flow can be run via the use of query params
    const queryParams = queryRef.current

    // (1) Actions like accessory cache removal have already started the restart process, so we don't need to do it again
    const restarting = queryParams.get('restarting') === 'true'

    if (restarting) {
      // `uiRestarting` says the UI is going down too (Update All schedules its
      // own restart), so the UI row must start as pending rather than ticked -
      // the first `homebridge-status` after it returns flips it.
      setUiOnline(queryParams.get('uiRestarting') !== 'true')
      checkIfServerUp()
    } else {
      void performRestart()
    }

    return () => {
      disposed = true
      statusCheckActive = false
      clearTimeout(settleTimer)
      clearTimeout(warningTimer)
      unsubscribeConnected()
      // The `status` namespace is cached and shared, so the listener must be
      // detached by reference or it would keep toasting and navigating from
      // whatever page the user moves to next
      io.socket.off('homebridge-status', handleHomebridgeStatus)
      io.end()
    }
  }, [])

  const viewLogs = () => {
    void navigate('/logs')
  }

  return (
    <>
      <div className="d-flex justify-content-between">
        <h3 className="primary-text m-0">{t('menu.restart.title')}</h3>
      </div>

      <div className="my-4 align-items-center container-narrow">
        <div className="w-100 text-center primary-text mb-5">
          <i aria-hidden="true" className="fas fa-power-off icon-xl"></i>
        </div>
        <div className="text-center">
          <h4 className="primary-text mb-4">{t('restart.title_restart')}</h4>
          {error
            ? <div className="alert alert-error my-4">{error}</div>
            : (
                <>
                  <p className="grey-text">{t('restart.please_wait_while_server_restarts')}</p>
                  <div className="justify-content-center my-4">
                    <div className="restart-progress-box primary-text">
                      <span>
                        <i aria-hidden="true" className={uiIcon}></i>
                        {' '}
                        {t('restart.ui_online')}
                      </span>
                    </div>
                    <div className="restart-progress-box primary-text">
                      <span className={uiOnline ? undefined : 'grey-text'}>
                        <i aria-hidden="true" className={serviceIcon}></i>
                        {' '}
                        {t('restart.service_ready')}
                      </span>
                    </div>
                  </div>
                </>
              )}
          {timedOut && (
            <div className="alert alert-warning my-4">
              <p>{t('restart.server_is_taking_long_time_to_restart')}</p>
              <p className="grey-text mb-0">
                {t('restart.label_restart_command_executed')}
                :
                {' '}
                <span className="font-monospace">{resp.command || 'End Process'}</span>
              </p>
              {uiOnline && (
                <p className="mt-2 mb-0">
                  <button type="button" className="btn btn-primary mb-0" onClick={viewLogs}>
                    {t('menu.tooltip_view_logs')}
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
