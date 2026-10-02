import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { useTerminal, useTerminalNavigationGuard } from '@/core/utilities/terminal'
import { createResizeEmitter, enterTerminalPage, leaveTerminalPage, patchXtermLiveRegion } from '@/modules/logs/terminal-page'

import './terminal.scss'

const BODY_CLASSES = ['theme-transition', 'light-mode', 'bg-black', 'bg-white']

/** The full-page interactive shell (`/platform-tools/terminal`). */
export function Terminal() {
  const { t } = useTranslation()
  const termTargetRef = useRef<HTMLDivElement>(null)
  const [resizeEvent] = useState(createResizeEmitter)
  const [terminalOptions] = useState(() => settingsActions.getTerminalOptions({ screenReaderMode: true }))

  // Set the body colours before the terminal starts (effects run in order)
  useEffect(() => {
    // Set page title
    settingsActions.setPageTitle(i18n.t('menu.linux.label_terminal'))
    enterTerminalPage(termTargetRef.current)
    return () => {
      // Navigating away from a crash or a hard route change skips canDeactivate,
      // so teardown has to clean up too
      window.document.body.classList.remove(...BODY_CLASSES)
    }
  }, [])

  // Start or reconnect to the terminal based on the persistence setting, and
  // detach / end it on the way out
  const terminal = useTerminal(termTargetRef, { options: terminalOptions, resize: resizeEvent })

  useEffect(() => {
    // Set focus to the terminal after next render to ensure it's initialized
    const frames: number[] = []
    frames.push(requestAnimationFrame(() => {
      patchXtermLiveRegion(termTargetRef.current)
      terminal.activateTerminal()
    }))
    const patchTimer = setTimeout(patchXtermLiveRegion, 0, termTargetRef.current)

    const onVisibilityChange = () => {
      // When tab becomes visible, focus this terminal
      if (!document.hidden && terminal.isTerminalReady()) {
        frames.push(requestAnimationFrame(() => {
          patchXtermLiveRegion(termTargetRef.current)
          terminal.activateTerminal()
        }))
      }
    }
    const onWindowResize = () => resizeEvent.next()
    const onWindowFocus = () => terminal.activateTerminal()

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('resize', onWindowResize)
    window.addEventListener('focus', onWindowFocus)
    return () => {
      frames.forEach(frame => cancelAnimationFrame(frame))
      clearTimeout(patchTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('resize', onWindowResize)
      window.removeEventListener('focus', onWindowFocus)
      resizeEvent.complete()
    }
  }, [terminal, resizeEvent])

  // The guard (unsaved session warning, beforeunload) decides first; then the fade
  useTerminalNavigationGuard({
    onLeave: nextPath => leaveTerminalPage(termTargetRef.current, nextPath),
  })

  return (
    <div
      className="hb-terminal"
      onClick={() => terminal.activateTerminal()}
      onTouchStart={event => terminal.onTouchStart(event)}
      onTouchEnd={event => terminal.onTouchEnd(event)}
    >
      <div className="row mb-3">
        <div className="col-12">
          <h3 className="primary-text m-0">{t('menu.linux.label_terminal')}</h3>
        </div>
      </div>
      <div className="flex-column d-flex align-items-stretch adjust-for-mobile">
        <div ref={termTargetRef} id="docker-terminal" className="align-self-end w-100 h-100 mb-1"></div>
      </div>
    </div>
  )
}
