import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { PluginLogsModalData } from '@/core/ui/modal-data'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Subject } from 'rxjs'

import { api, ApiError } from '@/core/api'
import { Confirm } from '@/core/components/confirm/Confirm'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { openModal } from '@/core/ui/modal'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { cx } from '@/core/utilities/cx'
import { fileSaver } from '@/core/utilities/file-saver'
import { toastApiError } from '@/core/utilities/http-error'
import { createLogService } from '@/core/utilities/terminal'

import { filterPluginLog, patchXtermLiveRegion } from './plugin-logs.helpers'

export type PluginLogsProps = PluginLogsModalData & ModalComponentProps

/** One plugin's lines of the Homebridge log, live, with download and child bridge restart. */
export function PluginLogs({ activeModal, plugin, childBridges: childBridgesProp, editorContext }: PluginLogsProps) {
  const { t } = useTranslation()
  const childBridges: ChildBridge[] = childBridgesProp ?? []
  const isLightTerminalTheme = useSettingsStore(() => settingsActions.getEffectiveTerminalLightingMode() === 'light')

  const [midAction, setMidAction] = useState(false)
  // One LogService per terminal: it holds that terminal's state
  const [log] = useState(createLogService)
  const [resizeEvent] = useState(() => new Subject<void>())
  const termTargetRef = useRef<HTMLDivElement>(null)
  const pluginAliasRef = useRef('')

  useEffect(() => {
    const onWindowResize = () => resizeEvent.next(undefined)
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [resizeEvent])

  useEffect(() => {
    let cancelled = false
    let frame = 0
    const getPluginLog = async () => {
      // Get the plugin name as configured in the config file
      if (!plugin) {
        return
      }
      try {
        const result: any[] = editorContext?.config
          ?? await api.get<any[]>(`/config-editor/plugin/${encodeURIComponent(plugin.name)}`)
        if (cancelled || !termTargetRef.current) {
          return
        }
        pluginAliasRef.current = plugin.name === '@mp-consulting/homebridge-config-glass-ui' ? 'Homebridge Glass UI' : (result[0]?.name || plugin.name)
        // Plugin logs are read-only — disable stdin so the xterm textarea is not a tab stop
        log.startTerminal(termTargetRef.current, settingsActions.getTerminalOptions({ disableStdin: true }), resizeEvent, pluginAliasRef.current)
        // Configure xterm's screen-reader live region for log announcements
        frame = requestAnimationFrame(() => patchXtermLiveRegion(termTargetRef.current))
      } catch (error) {
        if (cancelled) {
          return
        }
        console.error(error)
        toastApiError(error, 'toast.title_error')
        activeModal.dismiss()
      }
    }
    void getPluginLog()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      log.destroyTerminal()
    }
    // Started once, when the modal opens
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  const restartChildBridges = async () => {
    setMidAction(true)
    try {
      for (const bridge of childBridges) {
        await api.put(`/server/restart/${bridge.username}`, {})
      }
      toast.success(t('plugins.manage.child_bridge_restart'), t('toast.title_success'))
      setMidAction(false)
    } catch (error) {
      console.error(error)
      toast.error(t('plugins.manage.child_bridge_restart_failed'), t('toast.title_error'))
      setMidAction(false)
    }
  }

  const downloadLogFile = async () => {
    setMidAction(true)
    const ref = openModal(Confirm, {
      title: t('logs.title_download_log_file'),
      message: t('logs.download_warning'),
      confirmButtonLabel: t('form.button_download'),
      faIconClass: 'fas fa-user-secret primary-text',
    }, {
      size: 'lg',
      backdrop: 'static',
    })

    try {
      await ref.result
      try {
        const res = await api.get<string>('/platform-tools/hb-service/log/download?colour=yes', { observe: 'response', responseType: 'text' })
        if (!res.body) {
          // As in Angular, an empty log leaves the buttons disabled (open item)
          return
        }
        const finalOutput = filterPluginLog(res.body, pluginAliasRef.current)
        if (plugin) {
          fileSaver.saveAs(new Blob([finalOutput], { type: 'text/plain;charset=utf-8' }), `${plugin.name}.log.txt`)
        }
        setMidAction(false)
      } catch (err: any) {
        let message: string | undefined
        try {
          if (err instanceof ApiError && err.error?.text) {
            message = JSON.parse(await err.error.text()).message
          }
        } catch (error) {
          console.error(error)
        }
        toast.error(message || t('logs.download.error'), t('toast.title_error'))
        setMidAction(false)
      }
    } catch {
      setMidAction(false)
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const restartLabel = t(childBridges.length > 1 ? 'child_bridge.restart_plural' : 'child_bridge.restart')

  return (
    <div className={cx('modal-content', isLightTerminalTheme && 'terminal-light-theme')}>
      <ModalHeader title={plugin?.displayName || plugin?.name} closeDisabled={midAction} onClose={dismissModal} />
      <div className="modal-body d-flex flex-row flex-grow-1 w-100 p-0">
        <div
          ref={termTargetRef}
          className={cx(
            'w-100 plugin-log-output terminal align-self-end w-100 h-100 mb-0',
            !isLightTerminalTheme && 'terminal-dark-bg',
            isLightTerminalTheme && 'terminal-light-bg',
          )}
        >
        </div>
      </div>
      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            disabled={midAction}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <HoverTooltip text={t('logs.title_download_log_file')}>
            <button
              type="button"
              className="btn btn-primary"
              aria-label={t('logs.title_download_log_file')}
              disabled={midAction}
              onClick={() => void downloadLogFile()}
            >
              <i aria-hidden="true" className="fas fa-download"></i>
            </button>
          </HoverTooltip>
          {childBridges.length > 0 && (
            <HoverTooltip text={restartLabel}>
              <button
                type="button"
                className="btn btn-danger ms-3"
                aria-label={restartLabel}
                disabled={midAction}
                onClick={() => void restartChildBridges()}
              >
                <i aria-hidden="true" className="fas fa-power-off"></i>
              </button>
            </HoverTooltip>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
