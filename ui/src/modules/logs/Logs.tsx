import type { FormEvent, ReactElement } from 'react'

import { useEffect, useRef, useState } from 'react'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '@/core/auth'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { useCanDeactivate, useLog } from '@/core/utilities/terminal'

import { createResizeEmitter, enterTerminalPage, leaveTerminalPage, patchXtermLiveRegion } from './terminal-page'

import './logs.scss'

/** A hover tooltip below a toolbar button (ngbTooltip, placement bottom, openDelay 150). */
function ToolbarTooltip({ id, label, children }: { id: string, label: string, children: ReactElement }) {
  return (
    <OverlayTrigger placement="bottom" trigger={['hover', 'focus']} delay={{ show: 150, hide: 0 }} overlay={<Tooltip id={id}>{label}</Tooltip>}>
      {children}
    </OverlayTrigger>
  )
}

/** The Homebridge log, in a read-only xterm, with search, download and truncate. */
export function Logs() {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => state.user.admin)
  // Read once, at mount, like the Angular `terminalTheme` field
  const [terminalTheme] = useState(() => settingsActions.getEffectiveTerminalLightingMode())

  const termTargetRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [resizeEvent] = useState(createResizeEmitter)
  const [terminalOptions] = useState(() => settingsActions.getTerminalOptions({ disableStdin: true }))

  const [showSearchBar, setShowSearchBar] = useState(false)
  const [query, setQuery] = useState('')
  // Not rendered: it only tracks whether a filter is running
  const showExitButtonRef = useRef(false)

  // Helper to check if search input is invalid
  const trimmed = query.trim()
  const searchInputInvalid = trimmed.length > 0 && trimmed.length < 3

  // Set the body colours before the terminal starts (effects run in order)
  useEffect(() => {
    // Set page title
    settingsActions.setPageTitle(i18n.t('menu.linux.label_logs'))
    enterTerminalPage(termTargetRef.current)
    return () => {
      // Clean up light-mode class
      window.document.body.classList.remove('light-mode')
    }
  }, [])

  // Start the terminal (logs are read-only, no stdin); destroyed on unmount
  const log = useLog(termTargetRef, { options: terminalOptions, resize: resizeEvent })

  useEffect(() => {
    // Configure xterm's screen-reader live region for log announcements
    const frame = requestAnimationFrame(() => patchXtermLiveRegion(termTargetRef.current))
    const onWindowResize = () => resizeEvent.next()
    window.addEventListener('resize', onWindowResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onWindowResize)
    }
  }, [resizeEvent])

  useEffect(() => () => resizeEvent.complete(), [resizeEvent])

  // The query's valueChanges pipe: debounceTime(500) + distinctUntilChanged
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastQueryRef = useRef<string | undefined>(undefined)
  useEffect(() => () => clearTimeout(debounceTimerRef.current), [])

  const onQueryChanged = (value: string) => {
    if (value === lastQueryRef.current) {
      return
    }
    lastQueryRef.current = value

    // Trim whitespace from the beginning and end
    const trimmedValue = value.trim()
    if (trimmedValue !== value) {
      // Update the form value without emitting another event to avoid infinite loop
      setQueryValue(trimmedValue, false)
    }

    // Auto-search when query is 3 or more characters
    if (trimmedValue.length >= 3) {
      showExitButtonRef.current = true
      log.setSearchFilter(trimmedValue)
      log.scrollToBottom()
    } else if (showExitButtonRef.current) {
      // Clear the search only if it was previously active
      showExitButtonRef.current = false
      log.clearSearchFilter()
      log.scrollToBottom()
    }
  }

  function setQueryValue(value: string, emitEvent = true) {
    setQuery(value)
    if (emitEvent) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(onQueryChanged, 500, value)
    }
  }

  const showSearch = () => {
    if (showSearchBar) {
      setShowSearchBar(false)
      showExitButtonRef.current = false
      setQueryValue('')
      log.clearSearchFilter()
    } else {
      setShowSearchBar(true)
      setTimeout(() => searchInputRef.current?.focus(), 10)
    }
    setTimeout(resizeEvent.next, 10)
    log.scrollToBottom()
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedQuery = query.trim()

    // Require at least 3 characters for search
    if (!trimmedQuery.length || trimmedQuery.length < 3) {
      // If the query is empty, treat this as the user wanting to close the search
      if (!trimmedQuery.length) {
        setShowSearchBar(false)
      }
      // Clear the search box and show all logs when enter is pressed with invalid input
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

  useCanDeactivate(nextPath => leaveTerminalPage(termTargetRef.current, nextPath, () => {
    // Hide search bar immediately to avoid background color mismatch
    setShowSearchBar(false)
  }))

  return (
    <div className="hb-logs">
      <div className="row mb-3">
        <div className="col-6">
          <h3 className="primary-text m-0">{t('menu.linux.label_logs')}</h3>
        </div>
        {isAdmin && (
          <div className="col-6 text-end">
            <ToolbarTooltip id="logs-search-tooltip" label={t('form.search')}>
              <button
                type="button"
                className="btn btn-elegant my-0 me-2"
                aria-controls="logs-search-region"
                aria-label={t('form.search')}
                aria-expanded={showSearchBar}
                onClick={showSearch}
              >
                <i aria-hidden="true" className={`fas fa-search${showSearchBar ? ' primary-text' : ''}`}></i>
              </button>
            </ToolbarTooltip>
            <ToolbarTooltip id="logs-download-tooltip" label={t('form.button_download')}>
              <button
                type="button"
                className="btn btn-elegant my-0 me-2"
                aria-label={t('form.button_download')}
                onClick={() => void log.downloadLogFile()}
              >
                <i className="fas fa-download" aria-hidden="true"></i>
              </button>
            </ToolbarTooltip>
            <ToolbarTooltip id="logs-delete-tooltip" label={t('form.button_delete')}>
              <button
                type="button"
                className="btn btn-elegant my-0 me-0"
                aria-label={t('form.button_delete')}
                onClick={() => void log.truncateLogFile()}
              >
                <i className="fas fa-trash-alt" aria-hidden="true"></i>
              </button>
            </ToolbarTooltip>
          </div>
        )}
      </div>

      {showSearchBar && (
        <div id="logs-search-region" className="row">
          <div className="col-md-12">
            <form noValidate onSubmit={onSubmit}>
              <input
                ref={searchInputRef}
                type="text"
                id="logs-search"
                className={`search-bar${terminalTheme === 'light' ? ' search-bar-light' : ''}${searchInputInvalid ? ' is-invalid' : ''}`}
                name="query"
                value={query}
                placeholder={t('logs.placeholder_search_logs')}
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
        </div>
      )}

      <div className={`flex-column d-flex align-items-stretch ${showSearchBar ? 'adjust-for-mobile-with-search' : 'adjust-for-mobile'}`}>
        <div ref={termTargetRef} id="log-output" className="align-self-end w-100 h-100 mb-1"></div>
      </div>
    </div>
  )
}
