import type { WidgetProps } from '@/modules/status/widgets/widget.types'
import type { SyntheticEvent } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { settingsActions } from '@/core/settings'
import { terminalNavigationGuard, useTerminal } from '@/core/utilities/terminal'
import { patchXtermLiveRegion } from '@/modules/logs/terminal-page'

import { useFollowTerminalSettings } from './use-follow-terminal-settings'

import './terminal-widget.scss'

export function TerminalWidget({ resizeEvent }: WidgetProps) {
  const { t } = useTranslation()

  const widgetContainerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const termTargetRef = useRef<HTMLDivElement>(null)

  const [terminalHeight, setTerminalHeight] = useState(200)
  // Use effective theme to enforce dark mode override when needed (read once, at mount)
  const [theme] = useState(() => settingsActions.getEffectiveTerminalLightingMode())

  // Screen-reader-only collapse: keeps the xterm textarea out of the tab order
  // and the live region silent until SR users explicitly expand the widget.
  const [srExpanded, setSrExpanded] = useState(false)
  const srExpandedRef = useRef(srExpanded)
  srExpandedRef.current = srExpanded
  const [contentId] = useState(() => `terminal-content-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`)

  // Use global terminal settings from the settings store
  const [terminalOptions] = useState(() => settingsActions.getTerminalOptions({ cursorBlink: false }, true))

  // Starts (or reconnects to) the shared shell. autoFocus: false — the widget must
  // not pull focus on load, otherwise the browser scrolls the page down to the
  // terminal when it's lower on the dashboard. On the way out it detaches when
  // the session persists, and destroys it otherwise.
  const terminal = useTerminal(termTargetRef, { options: terminalOptions, resize: resizeEvent, autoFocus: false, variant: 'widget' })
  // Read before the hook's effect attaches the terminal: a reconnect to a terminal
  // that was already up skips the start-up a11y pass, as in Angular
  const [wasReady] = useState(() => terminal.isTerminalReady())

  // Pending deferred a11y passes, cleared on unmount
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      fn()
    }, ms)
    timersRef.current.add(timer)
  }

  // Mirror srExpanded onto the xterm textarea so collapsed widgets are not a tab stop
  // and don't expose stdin to screen readers.
  const applyTerminalA11yState = () => {
    const ta = termTargetRef.current?.querySelector('textarea')
    if (!ta) {
      return
    }
    if (srExpandedRef.current) {
      ta.removeAttribute('aria-hidden')
      ta.removeAttribute('tabindex')
    } else {
      ta.setAttribute('aria-hidden', 'true')
      ta.setAttribute('tabindex', '-1')
    }
  }

  const kickFocusOutOfCollapsedTerminal = () => {
    if (srExpandedRef.current) {
      return
    }
    const host = termTargetRef.current
    if (!host || !host.contains(document.activeElement)) {
      return
    }
    titleRef.current?.querySelector('button')?.focus()
  }

  // Runs after the expand / collapse has rendered
  const afterA11yChange = () => {
    applyTerminalA11yState()
    patchXtermLiveRegion(termTargetRef.current)
    if (srExpandedRef.current) {
      terminal.activateTerminal()
    }
  }

  const latest = { applyTerminalA11yState, afterA11yChange, later }
  const latestRef = useRef(latest)
  latestRef.current = latest

  const toggleSrExpanded = (event: SyntheticEvent) => {
    // The whole widget is clickable to focus the terminal, which would undo what this button does
    event.stopPropagation()
    const next = !srExpandedRef.current
    srExpandedRef.current = next
    setSrExpanded(next)

    later(() => {
      applyTerminalA11yState()
      patchXtermLiveRegion(termTargetRef.current)
      if (srExpandedRef.current) {
        resizeEvent.next()
        terminal.activateTerminal()
      } else {
        kickFocusOutOfCollapsedTerminal()
      }
    }, 0)
  }

  useEffect(() => {
    // Autofocus terminal when it is fully loaded, but only if SR users have
    // expanded the widget (otherwise the xterm textarea grabs focus and
    // disrupts keyboard navigation through the dashboard)
    if (!wasReady) {
      latestRef.current.later(() => latestRef.current.afterA11yChange(), 100)
    }

    const timers = timersRef.current
    return () => timers.forEach(clearTimeout)
  }, [wasReady])

  useEffect(() => resizeEvent.subscribe(() => {
    const widgetContainerHeight = widgetContainerRef.current?.offsetHeight ?? 0
    const titleHeight = titleRef.current?.offsetHeight ?? 0
    setTerminalHeight(widgetContainerHeight - titleHeight)
  }), [resizeEvent])

  // Subscribe to global terminal settings changes
  useFollowTerminalSettings(() => terminal.term, resizeEvent)

  useEffect(() => {
    // NOTE: This is a safeguard - the status page also handles beforeunload events
    // when terminal widgets are present, so this may not be strictly necessary
    const onBeforeUnload = (event: BeforeUnloadEvent) => terminalNavigationGuard.handleBeforeUnload(event)
    const onWindowFocus = () => {
      if (srExpandedRef.current) {
        terminal.activateTerminal()
      }
    }
    // When the tab becomes visible, focus this terminal - if it is actually on screen
    const onVisibilityChange = () => {
      if (!document.hidden && terminal.isTerminalReady()) {
        const rect = widgetContainerRef.current?.getBoundingClientRect()
        if (rect && rect.width > 0 && rect.height > 0) {
          latestRef.current.later(() => latestRef.current.afterA11yChange(), 100)
        }
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [terminal])

  const dark = theme === 'dark'

  // The Angular host listened for click / touch on the whole widget
  return (
    <div
      ref={widgetContainerRef}
      className={`hb-terminal-widget flex-column d-flex align-items-stretch h-100 w-100${dark ? ' widget-container-dark' : ''}`}
      onClick={() => terminal.activateTerminal()}
      onTouchStart={event => terminal.onTouchStart(event)}
      onTouchEnd={event => terminal.onTouchEnd(event)}
    >
      <div ref={titleRef} className={`drag-handler p-2${dark ? ' terminal-title-dark' : ''}`}>
        <span aria-hidden="true">{`Homebridge ${t('menu.docker.terminal')}`}</span>
        <button
          type="button"
          className="visually-hidden-focusable"
          aria-expanded={srExpanded}
          aria-controls={contentId}
          aria-label={t('menu.docker.terminal')}
          onClick={toggleSrExpanded}
        >
          {t('menu.docker.terminal')}
        </button>
      </div>
      <div
        className="p-2"
        id={contentId}
        style={{ height: `${terminalHeight}px` }}
        aria-hidden={srExpanded ? undefined : 'true'}
      >
        <div ref={termTargetRef} className="terminal gridster-item-content w-100 h-100 terminal-max-height"></div>
      </div>
    </div>
  )
}
