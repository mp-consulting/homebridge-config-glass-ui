import type { ModalComponentProps } from '@/core/ui/modal'
import type { WidgetControlModalData } from '@/core/ui/modal-data'
import type { ChangeEvent, KeyboardEvent } from 'react'

import type { Widget } from '../widgets/widget.types'
import type { WeatherLocation } from './widget-control.helpers'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { formatDatePattern } from '@/core/pipes/date-pattern'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { ws } from '@/core/ws'

import { dateFormats, findOpenWeatherMapCity, hasChanges, searchCountryCodeFormatter, timeFormats } from './widget-control.helpers'

export type WidgetControlProps = WidgetControlModalData & ModalComponentProps<Widget> & {
  widget: Widget
}

interface CityTypeaheadProps {
  value: WeatherLocation | undefined
  onChange: (value: WeatherLocation | undefined) => void
  onSearchingChange: (searching: boolean) => void
}

/**
 * The `ngbTypeahead` the city field used: searches 300 ms after typing stops,
 * from three characters, newest query wins; `editable: false`, so typed text
 * that is not a picked city leaves the model empty.
 */
function CityTypeahead({ value, onChange, onSearchingChange }: CityTypeaheadProps) {
  const [text, setText] = useState(() => (value ? searchCountryCodeFormatter(value) : ''))
  const [results, setResults] = useState<WeatherLocation[]>([])
  const [active, setActive] = useState(0)
  const lastTermRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inflightRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    clearTimeout(timerRef.current)
    inflightRef.current?.abort()
  }, [])

  const search = (term: string) => {
    // distinctUntilChanged
    if (term === lastTermRef.current) {
      return
    }
    lastTermRef.current = term
    // switchMap: a newer term cancels the one in flight
    inflightRef.current?.abort()
    onSearchingChange(true)
    if (term.length < 3) {
      setResults([])
      onSearchingChange(false)
      return
    }
    const controller = new AbortController()
    inflightRef.current = controller
    findOpenWeatherMapCity(term, controller.signal).then(
      (list) => {
        if (!controller.signal.aborted) {
          setResults(list)
          setActive(0)
          onSearchingChange(false)
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setResults([])
          onSearchingChange(false)
        }
      },
    )
  }

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const term = event.target.value
    setText(term)
    onChange(undefined)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(search, 300, term)
  }

  const select = (item: WeatherLocation) => {
    onChange(item)
    setText(searchCountryCodeFormatter(item))
    setResults([])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) {
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive(i => (i + 1) % results.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive(i => (i - 1 + results.length) % results.length)
        break
      case 'Enter':
      case 'Tab':
        event.preventDefault()
        select(results[active])
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        setResults([])
        break
      default:
    }
  }

  const open = results.length > 0
  return (
    <>
      <input
        id="city-search-input"
        type="text"
        className="form-control custom-input"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-owns={open ? 'city-search-typeahead' : undefined}
        aria-activedescendant={open ? `city-search-typeahead-${active}` : undefined}
        value={text}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(setResults, 150, [])}
      />
      {open && (
        <div id="city-search-typeahead" role="listbox" className="dropdown-menu show" style={{ position: 'absolute', top: '100%', left: 0 }}>
          {results.map((item, index) => (
            <button
              key={String(item.id)}
              id={`city-search-typeahead-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`dropdown-item${index === active ? ' active' : ''}`}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => select(item)}
            >
              {searchCountryCodeFormatter(item)}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function numberValue(event: ChangeEvent<HTMLInputElement>): number | undefined {
  // ngModel on a number input gave null for an empty box
  return event.target.value === '' ? null as unknown as undefined : Number(event.target.value)
}

/**
 * The settings of one widget. Edits a copy, so dismissing leaves the running
 * widget untouched; Save closes with the edited copy, which the dashboard
 * merges back into the layout.
 */
export function WidgetControl({ activeModal, widget: original }: WidgetControlProps) {
  const { t } = useTranslation()
  const [widget, setWidget] = useState<Widget>(() => ({ ...original }))
  const [searching, setSearching] = useState(false)
  const [serverInfo, setServerInfo] = useState<{ homebridgeRunningInDocker?: boolean } | null>(null)
  const [networkInterfaces, setNetworkInterfaces] = useState<string[]>([])
  const [currentDate] = useState(() => new Date())

  const set = (patch: Partial<Widget>) => setWidget(w => ({ ...w, ...patch }))

  useEffect(() => {
    let active = true
    if (original.component === 'NetworkWidgetComponent') {
      // Get a list of active network interfaces from the settings
      api.get<string[]>('/server/network-interfaces/bridge').then(
        (adapters) => {
          if (active) {
            setNetworkInterfaces(adapters)
          }
        },
        (error) => {
          console.error(error)
        },
      )
    }
    // The status page behind this modal already has the socket open
    const io = ws.getExistingNamespace('status')
    if (io) {
      io.request('get-homebridge-server-info').then(
        (info) => {
          if (active) {
            setServerInfo(info)
          }
        },
        (error) => {
          console.error('Failed to fetch server info:', error)
          if (active) {
            setServerInfo(null)
          }
        },
      )
    }
    return () => {
      active = false
    }
  }, [original.component])

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const closeModal = () => activeModal.close(widget)

  const checkbox = (id: 'showNpmVersion' | 'dockerExpanded' | 'showToolbar', label: string) => (
    <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
      <span className="text-start flex-grow-1 me-3" aria-hidden="true">{t(label)}</span>
      <div className="text-end grey-text d-flex align-items-center">
        <input
          type="checkbox"
          className="rendux-input"
          id={id}
          aria-label={t(label)}
          checked={!!widget[id]}
          onChange={event => set({ [id]: event.target.checked })}
        />
        <label htmlFor={id} className="rendux-label ms-3"></label>
      </div>
    </li>
  )

  const numberRow = (id: string, field: 'refreshInterval' | 'historyItems', label: string, unit: string) => (
    <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
      <label htmlFor={id} className="mb-2 mb-md-0 w-100 w-md-50">{t(label)}</label>
      <div className="text-start text-md-end w-100 w-md-50">
        <div className="input-group">
          <input
            id={id}
            type="number"
            className="form-control custom-input"
            min="1"
            max="60"
            value={widget[field] ?? ''}
            onChange={event => set({ [field]: numberValue(event) })}
          />
          <span className="input-group-text custom-input">{t(unit)}</span>
        </div>
      </div>
    </li>
  )

  const refreshAndHistory = (prefix: string) => (
    <>
      {numberRow(`${prefix}-refresh-interval`, 'refreshInterval', 'status.widget.network.refresh_interval', 'status.widget.network.seconds')}
      {numberRow(`${prefix}-history-items`, 'historyItems', 'status.widget.network.history_items', 'status.widget.network.items')}
    </>
  )

  const renderBody = () => {
    switch (widget.component) {
      case 'UpdateInfoWidgetComponent':
        return (
          <>
            {checkbox('showNpmVersion', 'status.widget.hide_npm')}
            {serverInfo?.homebridgeRunningInDocker && checkbox('dockerExpanded', 'status.widget.expand_docker')}
          </>
        )
      case 'WeatherWidgetComponent':
        return (
          <>
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="city-search-input" className="mb-2 mb-md-0 w-100 w-md-50">
                {t('status.widget.weather.label_search_for_your_city')}
              </label>
              <div className="text-start text-md-end w-100 w-md-50">
                <div className="input-group">
                  <span className="input-group-text custom-input" id="">
                    <i className={`fas${searching ? ' fa-circle-notch fa-spin' : ' fa-city'}`} aria-hidden="true"></i>
                  </span>
                  <CityTypeahead
                    value={widget.location as WeatherLocation | undefined}
                    onChange={location => set({ location: location as Widget['location'] })}
                    onSearchingChange={setSearching}
                  />
                </div>
              </div>
            </li>
            <li className="list-group-item muted grey-text text-center">
              {t('status.widget.weather.provider', { openWeather: 'OpenWeather' })}
            </li>
          </>
        )
      case 'ClockWidgetComponent':
        return (
          <>
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="clock-time-format" className="mb-2 mb-md-0 w-100 w-md-50">{t('status.widget.clock_timeformat')}</label>
              <div className="text-start text-md-end w-100 w-md-50">
                <select id="clock-time-format" className="custom-select" value={widget.timeFormat ?? ''} onChange={event => set({ timeFormat: event.target.value })}>
                  {timeFormats.map(timeFormat => (
                    <option key={timeFormat} value={timeFormat}>{formatDatePattern(currentDate, timeFormat)}</option>
                  ))}
                </select>
              </div>
            </li>
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="clock-date-format" className="mb-2 mb-md-0 w-100 w-md-50">{t('status.widget.clock_dateformat')}</label>
              <div className="text-start text-md-end w-100 w-md-50">
                <select id="clock-date-format" className="custom-select" value={widget.dateFormat ?? ''} onChange={event => set({ dateFormat: event.target.value })}>
                  {dateFormats.map(dateFormat => (
                    <option key={dateFormat} value={dateFormat}>{formatDatePattern(currentDate, dateFormat)}</option>
                  ))}
                </select>
              </div>
            </li>
          </>
        )
      case 'HomebridgeLogsWidgetComponent':
        return checkbox('showToolbar', 'status.widget.show_toolbar')
      case 'CpuWidgetComponent':
        return refreshAndHistory('cpu')
      case 'MemoryWidgetComponent':
        return refreshAndHistory('memory')
      case 'NetworkWidgetComponent':
        return (
          <>
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="network-interface" className="mb-2 mb-md-0 w-100 w-md-50">{t('status.widget.network.network_interface')}</label>
              <div className="text-start text-md-end w-100 w-md-50">
                {networkInterfaces.length
                  ? (
                      <select id="network-interface" className="custom-select" value={widget.networkInterface ?? ''} onChange={event => set({ networkInterface: event.target.value })}>
                        {networkInterfaces.map(networkInterface => (
                          <option key={networkInterface} value={networkInterface}>{networkInterface}</option>
                        ))}
                      </select>
                    )
                  : <span className="grey-text">{t('status.widget.network.none_selected')}</span>}
              </div>
            </li>
            {refreshAndHistory('network')}
          </>
        )
      default:
        return null
    }
  }

  return (
    <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="widget-control-modal-title">
      <ModalHeader title={t('status.widget.title_manage_widget')} titleId="widget-control-modal-title" onClose={dismissModal} />
      <div className="modal-body">
        <ul className="list-group list-group-box mb-0">
          {renderBody()}
        </ul>
      </div>
      <ModalFooter>
        <div className="text-start">
          <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" aria-label={t('form.button_close')} onClick={dismissModal}>
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button type="button" className="btn btn-primary" data-bs-dismiss="modal" disabled={!hasChanges(widget, original)} onClick={closeModal}>
            {t('form.button_save')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
