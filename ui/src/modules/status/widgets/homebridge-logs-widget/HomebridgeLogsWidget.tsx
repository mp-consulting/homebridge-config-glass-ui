import type { LogService } from '@/core/utilities/terminal'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'
import type { FormEvent, SyntheticEvent } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { openLogDoctor } from '@/core/ai/ai-entry'
import { useAiEnabled } from '@/core/ai/ai.store'
import { useAuthStore } from '@/core/auth'
import { settingsActions } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { cx } from '@/core/utilities/cx'
import { useDebouncedCallback } from '@/core/utilities/debounce'
import { useLog } from '@/core/utilities/terminal'
import { patchXtermLiveRegion } from '@/modules/logs/terminal-page'
import { useFollowTerminalSettings } from '@/modules/status/widgets/terminal-widget/use-follow-terminal-settings'

import './homebridge-logs-widget.scss'

/** Keep a press on a toolbar button from starting a grid drag. */
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation()

export function HomebridgeLogsWidget({ widget, resizeEvent }: WidgetProps) {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => state.user.admin)
  const aiEnabled = useAiEnabled()

  const widgetContainerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const termTargetRef = useRef<HTMLDivElement>(null)

  const [terminalHeight, setTerminalHeight] = useState(200)
  // Use effective theme to enforce dark mode override when needed (read once, at mount)
  const [theme] = useState(() => settingsActions.getEffectiveTerminalLightingMode())
  const [showSearchBar, setShowSearchBar] = useState(false)
  const [query, setQuery] = useState('')
  // Not rendered: it only tracks whether a filter this widget set is running
  const showExitButtonRef = useRef(false)

  // Screen-reader-only collapse: keeps the xterm live region quiet until SR users
  // explicitly expand the widget. Visual presentation is unchanged for sighted users.
  const [srExpanded, setSrExpanded] = useState(false)
  const [contentId] = useState(() => `homebridge-logs-content-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`)

  const trimmed = query.trim()
  const searchInputInvalid = trimmed.length > 0 && trimmed.length < 3

  // Logs are read-only, so disable stdin to keep the xterm textarea out of the tab order
  const [terminalOptions] = useState(() => settingsActions.getTerminalOptions({
    cursorBlink: false,
    disableStdin: true,
  }, true))
  // Clear any active search filter so it doesn't bleed into the Logs page.
  // Declared before useLog: cleanups run in order, so this one runs while the terminal is still up
  const logRef = useRef<LogService>(null)
  useEffect(() => () => {
    if (showExitButtonRef.current) {
      logRef.current?.clearSearchFilter()
    }
  }, [])
  const log = useLog(termTargetRef, { options: terminalOptions, resize: resizeEvent })
  logRef.current = log

  // Resize updates are skipped until the terminal is up
  const initializedRef = useRef(false)

  useEffect(() => {
    // Configure xterm's screen-reader live region for log announcements
    const frame = requestAnimationFrame(() => patchXtermLiveRegion(termTargetRef.current))
    initializedRef.current = true
    // Trigger initial resize to calculate height and fit terminal
    const timer = setTimeout(() => resizeEvent.next(), 100)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      initializedRef.current = false
    }
  }, [resizeEvent])

  useEffect(() => resizeEvent.subscribe(() => {
    if (!initializedRef.current) {
      return
    }
    const widgetContainerHeight = widgetContainerRef.current?.offsetHeight ?? 0
    const titleHeight = titleRef.current?.offsetHeight ?? 0
    const searchHeight = searchContainerRef.current?.offsetHeight ?? 0
    setTerminalHeight(widgetContainerHeight - titleHeight - searchHeight)
  }), [resizeEvent])

  // Subscribe to global terminal settings changes
  useFollowTerminalSettings(() => log.term, resizeEvent)

  // The query's valueChanges pipe: debounceTime(500) + distinctUntilChanged
  const lastQueryRef = useRef<string | undefined>(undefined)
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = timersRef.current
    return () => timers.forEach(clearTimeout)
  }, [])

  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      fn()
    }, ms)
    timersRef.current.add(timer)
  }

  const onQueryChanged = (value: string) => {
    if (value === lastQueryRef.current) {
      return
    }
    lastQueryRef.current = value
    const trimmedValue = value.trim()
    if (trimmedValue !== value) {
      // Update the form value without emitting another event to avoid infinite loop
      setQueryValue(trimmedValue, false)
    }
    if (trimmedValue.length >= 3) {
      showExitButtonRef.current = true
      log.setSearchFilter(trimmedValue)
      log.scrollToBottom()
    } else if (showExitButtonRef.current) {
      showExitButtonRef.current = false
      log.clearSearchFilter()
      log.scrollToBottom()
    }
  }

  const queryChanged = useDebouncedCallback(onQueryChanged, 500)

  function setQueryValue(value: string, emitEvent = true) {
    setQuery(value)
    if (emitEvent) {
      queryChanged(value)
    }
  }

  const toggleSrExpanded = (event: SyntheticEvent) => {
    event.stopPropagation()
    setSrExpanded(value => !value)
  }

  const showSearch = () => {
    if (showSearchBar) {
      setShowSearchBar(false)
      showExitButtonRef.current = false
      setQueryValue('')
      log.clearSearchFilter()
    } else {
      setShowSearchBar(true)
      later(() => searchInputRef.current?.focus(), 10)
    }
    later(() => resizeEvent.next(), 10)
    log.scrollToBottom()
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedQuery = query.trim()
    if (!trimmedQuery.length || trimmedQuery.length < 3) {
      if (!trimmedQuery.length) {
        setShowSearchBar(false)
        later(() => resizeEvent.next(), 10)
      }
      setQueryValue('')
      showExitButtonRef.current = false
      log.clearSearchFilter()
    } else {
      showExitButtonRef.current = true
      log.setSearchFilter(trimmedQuery)
    }
    log.scrollToBottom()
  }

  const onClearSearch = () => {
    setQueryValue('')
    showExitButtonRef.current = false
    log.clearSearchFilter()
    log.scrollToBottom()
  }

  const dark = theme === 'dark'

  return (
    <div
      ref={widgetContainerRef}
      className={cx('hb-homebridge-logs-widget flex-column d-flex align-items-stretch h-100 w-100', dark && 'widget-container-dark')}
    >
      <div
        ref={titleRef}
        className={cx('drag-handler logs-card-header d-flex align-items-center justify-content-between', dark && 'terminal-title-dark')}
      >
        <span className="logs-card-title" aria-hidden="true">
          <i className="fas fa-wave-square" aria-hidden="true"></i>
          {' '}
          {t('status.widget.homebridge_logs')}
        </span>
        <button
          type="button"
          className="visually-hidden-focusable"
          aria-expanded={srExpanded}
          aria-controls={contentId}
          aria-label={t('status.widget.homebridge_logs')}
          onClick={toggleSrExpanded}
        >
          {t('status.widget.homebridge_logs')}
        </button>
        {isAdmin && widget.showToolbar && (
          <div className={cx('d-flex gap-1 widget-toolbar logs-toolbar', widget.draggable && 'with-gear')}>
            <HoverTooltip text={t('status.widget.logs_open_page')} placement="bottom">
              <Link
                className="widget-toolbar-button"
                to="/logs"
                aria-label={t('status.widget.logs_open_page')}
                onMouseDown={stopPropagation}
                onTouchStart={stopPropagation}
              >
                <i className="fas fa-up-right-and-down-left-from-center" aria-hidden="true"></i>
              </Link>
            </HoverTooltip>
            {aiEnabled && (
              <HoverTooltip text={t('ai.log_doctor.diagnose')} placement="bottom">
                <button
                  type="button"
                  className="widget-toolbar-button hb-ai-widget-diagnose"
                  aria-label={t('ai.log_doctor.diagnose')}
                  onMouseDown={stopPropagation}
                  onTouchStart={stopPropagation}
                  onClick={() => openLogDoctor()}
                >
                  <i className="fas fa-wand-magic-sparkles" aria-hidden="true"></i>
                </button>
              </HoverTooltip>
            )}
            <HoverTooltip text={t('form.search')} placement="bottom">
              <button
                type="button"
                className="widget-toolbar-button"
                aria-label={t('form.search')}
                onMouseDown={stopPropagation}
                onTouchStart={stopPropagation}
                onClick={showSearch}
              >
                <i aria-hidden="true" className={cx('fas fa-search', showSearchBar && 'primary-text')}></i>
              </button>
            </HoverTooltip>
            <HoverTooltip text={t('form.button_download')} placement="bottom">
              <button
                type="button"
                className="widget-toolbar-button"
                aria-label={t('form.button_download')}
                onMouseDown={stopPropagation}
                onTouchStart={stopPropagation}
                onClick={() => void log.downloadLogFile()}
              >
                <i className="fas fa-download" aria-hidden="true"></i>
              </button>
            </HoverTooltip>
            <HoverTooltip text={t('form.button_delete')} placement="bottom">
              <button
                type="button"
                className="widget-toolbar-button"
                aria-label={t('form.button_delete')}
                onMouseDown={stopPropagation}
                onTouchStart={stopPropagation}
                onClick={() => void log.truncateLogFile()}
              >
                <i className="fas fa-trash-alt" aria-hidden="true"></i>
              </button>
            </HoverTooltip>
          </div>
        )}
      </div>
      {showSearchBar && (
        <div ref={searchContainerRef} className="position-relative px-2 pt-1">
          <form noValidate onSubmit={onSubmit}>
            <input
              ref={searchInputRef}
              type="text"
              className={cx('search-bar', theme === 'light' && 'search-bar-light', searchInputInvalid && 'is-invalid')}
              name="query"
              aria-label={t('logs.placeholder_search_logs')}
              placeholder={t('logs.placeholder_search_logs')}
              value={query}
              onChange={event => setQueryValue(event.target.value)}
            />
            {query && (
              <button
                type="button"
                className="search-bar-clear"
                aria-label={t('form.button_clear')}
                onClick={onClearSearch}
              >
                <i className="fas fa-square-xmark" aria-hidden="true"></i>
              </button>
            )}
          </form>
        </div>
      )}
      <div
        className="logs-body"
        id={contentId}
        style={{ height: `${terminalHeight}px` }}
        aria-hidden={srExpanded ? undefined : 'true'}
      >
        {/* Inset pane for the log text; its top edge fades so older lines slide out under the header */}
        <div className="logs-well h-100">
          <div ref={termTargetRef} className="terminal gridster-item-content w-100 h-100 terminal-max-height"></div>
        </div>
      </div>
    </div>
  )
}
