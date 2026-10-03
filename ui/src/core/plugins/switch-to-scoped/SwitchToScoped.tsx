import type { ModalComponentProps } from '@/core/ui/modal'
import type { SwitchToScopedModalData } from '@/core/ui/modal-data'
import type { IoNamespace } from '@/core/ws'
import type { Terminal } from '@xterm/xterm'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { escapeHtml } from '@/core/helpers/html.helper'
import { RE_ANSI } from '@/core/regex.constants'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { cx } from '@/core/utilities/cx'
import { fileSaver } from '@/core/utilities/file-saver'
import { toastApiError, toToastMessage } from '@/core/utilities/http-error'
import { hideXtermInputFromScreenReader, xtermFactory } from '@/core/utilities/terminal'
import { ws } from '@/core/ws'

import './switch-to-scoped.scss'

export type SwitchToScopedProps = SwitchToScopedModalData & ModalComponentProps

/** The icon-only wiki link, named for screen readers by `label` */
function moreInfoLink(label: string): string {
  return `<a href="https://github.com/homebridge/plugins/wiki/Scoped-Plugins" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}"><i class="fas fa-up-right-from-square primary-text" aria-hidden="true"></i></a>`
}
const prefix = '<span class="font-monospace">@homebridge-plugins/</span>'

/** Move a plugin to its `@homebridge-plugins/` name: install the new, remove the old, restart. */
export function SwitchToScoped({ activeModal, plugin }: SwitchToScopedProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const onlineUpdateOk = useSettingsStore(state => state.env.platform !== 'win32')
  const isLightTerminalTheme = useSettingsStore(() => settingsActions.getEffectiveTerminalLightingMode() === 'light')

  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [uninstalled, setUninstalled] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [failure, setFailure] = useState('')

  const outputRef = useRef<HTMLDivElement>(null)
  const ioRef = useRef<IoNamespace | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const errorLogRef = useRef('')

  useEffect(() => {
    const term = xtermFactory.createTerminal(settingsActions.getTerminalOptions({ disableStdin: true }))
    const fitAddon = xtermFactory.createFitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(xtermFactory.createWebLinksAddon())
    termRef.current = term

    const io = ws.connectToNamespace('plugins')
    ioRef.current = io
    const target = outputRef.current!
    term.open(target)
    const xtermA11yDisposer = hideXtermInputFromScreenReader(target)
    // Defer fit() to the next tick. The modal's host element can have
    // zero size on the first tick after open, so calling fit() inline
    // would size the terminal to 0×0 and the user sees a blank pane
    // until the next resize event.
    const fitTimer = setTimeout(() => fitAddon.fit(), 0)

    const stdoutHandler = (data: string | Uint8Array) => {
      term.write(data)
      const dataCleaned = data
        .toString()
        .replace(RE_ANSI, '')
        .trimEnd()
      if (dataCleaned) {
        errorLogRef.current += `${dataCleaned}\r\n`
      }
    }
    io.socket.on('stdout', stdoutHandler)

    return () => {
      clearTimeout(fitTimer)
      // The plugins namespace is cached and shared, and `end()` keeps its
      // listeners, so detach ours before ending the session
      io.socket.off('stdout', stdoutHandler)
      io.end?.()
      xtermA11yDisposer?.()
      term.dispose()
    }
  }, [])

  const doSwitch = async () => {
    const io = ioRef.current
    const term = termRef.current
    if (!plugin || !io || !term) {
      return
    }

    // Which step is running, for the error path (state reads here would be stale)
    let step: 'install' | 'uninstall' | 'restart' = 'install'
    try {
      setInstalling(true)

      // 1. Install new plugin
      await io.request('install', {
        name: plugin.newHbScope.to,
        version: plugin.newHbScope.switch,
        termCols: term.cols,
        termRows: term.rows,
      })

      setInstalling(false)
      setInstalled(true)
      setUninstalling(true)
      step = 'uninstall'

      // 2. Uninstall old plugin
      await io.request('uninstall', {
        name: plugin.newHbScope.from,
        termCols: term.cols,
        termRows: term.rows,
      })

      setUninstalling(false)
      setUninstalled(true)
      setRestarting(true)
      step = 'restart'

      // 3. Set full service restart flag
      await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})

      activeModal.close()
      void navigate('/restart')
    } catch (error) {
      if (step === 'install') {
        setInstalling(false)
      } else if (step === 'uninstall') {
        setUninstalling(false)
      } else {
        setRestarting(false)
      }

      setFailure(toToastMessage(error))
      console.error(error)
      toastApiError(error)
    }
  }

  const downloadLogFile = () => {
    if (!plugin) {
      return
    }
    const blob = new Blob([errorLogRef.current], { type: 'text/plain;charset=utf-8' })
    fileSaver.saveAs(blob, `${plugin.name}-error.log`)
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const busy = installing || uninstalling || restarting

  return (
    <div className="modal-content hb-switch-to-scoped">
      <ModalHeader title={t('plugins.manage.scoped.switch')} closeDisabled={busy} onClose={dismissModal} />
      <div className="modal-body">
        <div className="mb-3 text-center">
          <i className="fas fa-arrow-right-arrow-left primary-text icon-xl"></i>
        </div>
        <ul className="mb-0">
          <SafeHtml as="li" html={t('plugins.manage.scoped.info_1', { prefix })} />
          <li>{t('plugins.manage.scoped_message')}</li>
          <SafeHtml as="li" html={t('plugins.manage.scoped.info_2', { link: moreInfoLink(t('plugins.manage.link_scoped_wiki')) })} />
          {onlineUpdateOk
            ? <li>{t('plugins.manage.scoped.process')}</li>
            : (
                <>
                  <SafeHtml as="li" html={t('plugins.manage.scoped.windows')} />
                  <li>{t('plugins.manage.manual_update_command')}</li>
                </>
              )}
        </ul>
        {plugin && !onlineUpdateOk && (
          <pre className="mt-3 mb-0">
            {`hb-service stop
npm install -g ${plugin.newHbScope.to}@${plugin.newHbScope.switch}
npm uninstall -g ${plugin.newHbScope.from}
hb-service start`}
          </pre>
        )}
        {plugin && onlineUpdateOk && (
          <div className="text-center">
            <ul className="d-inline-block text-start mt-3 mb-3 switch-steps-list">
              <li>
                <i
                  className={cx(
                    'fa',
                    !installing && !installed && !failure && 'fa-circle-o',
                    installing && 'fa-circle-notch fa-spin',
                    installed && !failure && 'fa-check-circle green-text',
                    !installed && failure && 'fa-times-circle red-text',
                  )}
                >
                </i>
                {' '}
                {t('plugins.manage.install')}
                {' '}
                <span className="font-monospace">{plugin.newHbScope.to}</span>
              </li>
              <li>
                <i
                  className={cx(
                    'fa',
                    !uninstalling && !uninstalled && !failure && 'fa-circle-o',
                    uninstalling && 'fa-circle-notch fa-spin',
                    uninstalled && !failure && 'fa-check-circle green-text',
                    !uninstalled && failure && 'fa-times-circle red-text',
                  )}
                >
                </i>
                {' '}
                {t('plugins.manage.uninstall')}
                {' '}
                <span className="font-monospace">{plugin.newHbScope.from}</span>
              </li>
              <li>
                <i
                  className={cx(
                    'fa',
                    !restarting && !failure && 'fa-circle-o',
                    restarting && 'fa-circle-notch fa-spin',
                    failure && 'fa-times-circle red-text',
                  )}
                >
                </i>
                {' '}
                {t('menu.hbrestart.title')}
              </li>
            </ul>
          </div>
        )}
        {failure && (
          <div className="alert alert-error mb-0">
            <p>{t('plugins.manage.scoped.error')}</p>
            <p className="font-monospace">{failure}</p>
            <button type="button" className="btn btn-primary mb-0" onClick={downloadLogFile}>
              {t('form.button_download')}
            </button>
          </div>
        )}
        <div
          ref={outputRef}
          className={cx('mb-0', !isLightTerminalTheme && 'terminal-dark-bg', isLightTerminalTheme && 'terminal-light-bg')}
          id="plugin-output"
          hidden={!onlineUpdateOk || Boolean(failure)}
        >
        </div>
      </div>
      <ModalFooter>
        <div className="text-start">
          {onlineUpdateOk && (
            <button
              type="button"
              className="btn btn-elegant"
              data-bs-dismiss="modal"
              aria-label={t('form.button_close')}
              disabled={busy}
              onClick={dismissModal}
            >
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-center">
          {!onlineUpdateOk && (
            <button
              type="button"
              className="btn btn-elegant"
              data-bs-dismiss="modal"
              aria-label={t('form.button_close')}
              disabled={busy}
              onClick={dismissModal}
            >
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-end">
          {onlineUpdateOk && (
            <button
              type="button"
              className="btn btn-primary"
              data-bs-dismiss="modal"
              disabled={busy || !onlineUpdateOk || Boolean(failure)}
              onClick={() => void doSwitch()}
            >
              {!busy && <span>{t('form.button_continue')}</span>}
              {busy && !failure && <InlineSpinner />}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
