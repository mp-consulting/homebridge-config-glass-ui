import type { ChildBridgeHealth, ChildBridgeHealthReport } from './child-bridge-health'

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { cx } from '@/core/utilities/cx'
import { toastApiError } from '@/core/utilities/http-error'

import { fetchChildBridgeHealth, formatUptime, HEALTH_POLL_MS } from './child-bridge-health'

const STATUS_KEYS: Record<ChildBridgeHealth['status'], string> = {
  ok: 'child_bridge.health.status_ok',
  pending: 'child_bridge.health.status_pending',
  down: 'child_bridge.health.status_down',
}

function statusClass(bridge: ChildBridgeHealth): string {
  if (bridge.crashLoop) {
    return 'bg-danger'
  }
  if (bridge.status === 'ok') {
    return 'bg-success'
  }
  return bridge.status === 'pending' ? 'bg-warning text-dark' : 'bg-secondary'
}

/** `/child-bridges`: each child bridge's status, uptime, restarts, crashes and crash-loop state. */
export function ChildBridgeHealthPage() {
  const { t } = useTranslation()
  const [report, setReport] = useState<ChildBridgeHealthReport | null>(null)
  const [restarting, setRestarting] = useState<string | null>(null)

  useEffect(() => {
    settingsActions.setPageTitle(i18n.t('child_bridge.health.title'))
  }, [])

  const load = useCallback(async () => {
    try {
      setReport(await fetchChildBridgeHealth())
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) {
        void load()
      }
    }, HEALTH_POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const restart = async (bridge: ChildBridgeHealth) => {
    setRestarting(bridge.username)
    try {
      await api.put(`/server/restart/${bridge.username.replace(/:/g, '')}`, {})
      toast.success(t('child_bridge.health.restart_sent', { name: bridge.name }), t('toast.title_success'))
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
    setRestarting(null)
  }

  if (!report) {
    return (
      <div className="text-center primary-text mt-5">
        <InlineSpinner className="icon-xl" />
      </div>
    )
  }

  const looping = report.bridges.filter(bridge => bridge.crashLoop)
  const showMemory = report.bridges.some(bridge => bridge.memoryRss !== undefined)

  return (
    <div className="hb-child-bridge-health container-fluid px-0">
      <h4 className="mb-2">{t('child_bridge.health.title')}</h4>
      <p className="grey-text small mb-3">
        {t('child_bridge.health.help', { crashes: report.crashLoop.crashes, minutes: report.crashLoop.windowMinutes })}
      </p>
      {looping.length > 0 && (
        <div role="alert" className="alert alert-danger show fade">
          <i className="fas fa-triangle-exclamation me-2" aria-hidden="true"></i>
          {t('child_bridge.health.crash_loop_alert', { names: looping.map(bridge => bridge.name).join(', ') })}
        </div>
      )}
      {report.bridges.length === 0
        ? <p className="text-center grey-text mt-4">{t('child_bridge.health.none')}</p>
        : (
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th scope="col">{t('child_bridge.health.bridge')}</th>
                    <th scope="col">{t('child_bridge.health.status')}</th>
                    <th scope="col">{t('child_bridge.health.uptime')}</th>
                    <th scope="col" className="text-end">{t('child_bridge.health.restarts')}</th>
                    <th scope="col" className="text-end">{t('child_bridge.health.crashes')}</th>
                    {showMemory && <th scope="col" className="text-end">{t('child_bridge.health.memory')}</th>}
                    <th scope="col"><span className="visually-hidden">{t('child_bridge.health.actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {report.bridges.map(bridge => (
                    <tr key={bridge.username} data-username={bridge.username}>
                      <td>
                        {bridge.name}
                        <br />
                        <small className="grey-text">{bridge.plugin}</small>
                      </td>
                      <td>
                        <span className={cx('badge', statusClass(bridge))}>
                          {bridge.crashLoop
                            ? t('child_bridge.health.crash_loop')
                            : bridge.manuallyStopped
                              ? t('child_bridge.health.stopped')
                              : t(STATUS_KEYS[bridge.status])}
                        </span>
                      </td>
                      <td>{formatUptime(bridge.uptime)}</td>
                      <td className="text-end">{bridge.restartCount}</td>
                      <td className="text-end">
                        {bridge.crashCount}
                        {bridge.recentCrashes > 0 && (
                          <small className="grey-text ms-1">
                            (
                            {t('child_bridge.health.recent', { count: bridge.recentCrashes })}
                            )
                          </small>
                        )}
                      </td>
                      {showMemory && (
                        <td className="text-end">
                          {bridge.memoryRss !== undefined ? `${Math.round(bridge.memoryRss / 1024 / 1024)} MB` : '—'}
                        </td>
                      )}
                      <td className="text-end">
                        <button
                          type="button"
                          className="btn btn-sm btn-elegant m-0"
                          disabled={restarting !== null}
                          aria-label={t('child_bridge.health.restart', { name: bridge.name })}
                          onClick={() => void restart(bridge)}
                        >
                          <i aria-hidden="true" className={restarting === bridge.username ? 'fas fa-circle-notch fa-spin' : 'fas fa-redo'}></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  )
}
