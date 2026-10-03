import type { Mock } from 'vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/core/settings'
import { getWeatherIconClass } from '@/modules/status/widgets/weather-widget/weather-icon'
import { WeatherWidget } from '@/modules/status/widgets/weather-widget/WeatherWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'
import { makeSettingsState } from '@/testing'

vi.mock('@/core/ws/ws', async importOriginal => ({
  ...(await importOriginal<object>()),
  ws: (await import('@/testing')).fakeWs(),
}))

/**
 * The weather widget is the only thing in the app that calls a third-party API,
 * so it caches for twenty minutes and shows the cached reading rather than a spinner.
 */
describe('the weather widget', () => {
  const owmUrl = 'https://api.openweathermap.org/data/2.5/weather'
  let fetchMock: Mock<(...args: any[]) => any>
  let reading: any

  function makeReading(icon = '01d', temp = 18) {
    return { weather: [{ icon, description: 'clear sky' }], main: { temp }, name: 'London' }
  }

  const owmCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(owmUrl))

  async function open(widget: Record<string, any> = {}, options: { env?: Record<string, any> } = {}) {
    useSettingsStore.setState(makeSettingsState({ env: options.env }))
    const configureEvent = createWidgetEvent()
    const result = render(
      <WeatherWidget
        widget={{ component: 'WeatherWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false, ...widget }}
        resizeEvent={createWidgetEvent()}
        configureEvent={configureEvent}
        updateWidget={vi.fn()}
        saveWidgets={vi.fn()}
      />,
    )
    await act(async () => {})
    return { ...result, configureEvent }
  }

  const london = { location: { id: 2643743, name: 'London' } }
  const icon = (container: HTMLElement) => container.querySelector('.weather-now h1 i')?.className

  beforeEach(() => {
    reading = makeReading()
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => reading }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for nothing until a location is chosen', async () => {
    await open()

    // The widget is added before it is configured, and a request with no id would just waste an API call
    expect(owmCalls()).toHaveLength(0)
    expect(screen.getByText('status.widget.weather.label_config_required_help')).toBeInTheDocument()
  })

  it('fetches the weather for the configured location', async () => {
    const { container } = await open(london)

    expect(owmCalls()).toHaveLength(1)
    const url = new URL(owmCalls()[0][0])
    expect(url.searchParams.get('id')).toBe('2643743')
    expect(url.searchParams.get('units')).toBe('metric')
    expect(url.searchParams.get('appid')).toBeTruthy()
    expect(container.querySelector('.drag-handler')).toHaveTextContent('London status.widget.weather.title_weather')
    expect(container.querySelector('.weather-now h3')).toHaveTextContent('Clear Sky')
    expect(container.querySelector('.weather-now h2')).toHaveTextContent('18°C')
  })

  it('shows a spinner while the first reading loads', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const { container } = await open(london)

    expect(container.querySelector('.fa-circle-notch')).not.toBeNull()
    expect(screen.getByRole('status', { name: 'common.a11y.loading' })).toBeInTheDocument()
  })

  it('says the weather could not be loaded, with a retry, instead of spinning forever', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    const { container } = await open(london)

    expect(container.querySelector('.fa-circle-notch')).toBeNull()
    expect(screen.getByText('status.widget.weather.error_loading')).toBeInTheDocument()

    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => reading }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_retry' }))
    })

    expect(owmCalls()).toHaveLength(2)
    expect(container.querySelector('.weather-now h2')).toHaveTextContent('18°C')
    expect(screen.queryByText('status.widget.weather.error_loading')).toBeNull()
  })

  it('remembers the reading for next time', async () => {
    await open(london)

    // Stamped with the time it arrived, which is what the freshness check reads
    const stored = JSON.parse(window.localStorage.getItem('weather-2643743')!)
    expect(stored.name).toBe('London')
    expect(stored.timestamp).toBeTruthy()
  })

  it('shows a recent reading without asking again', async () => {
    window.localStorage.setItem('weather-2643743', JSON.stringify({ ...makeReading('10d', 12), timestamp: new Date().toISOString() }))

    const { container } = await open(london)

    // OpenWeatherMap rate-limits the free tier, and several browser tabs each reloading would burn through it
    expect(owmCalls()).toHaveLength(0)
    expect(container.querySelector('.weather-now h2')).toHaveTextContent('12°C')
  })

  it('does not ask again on a reconfigure while the cache is fresh', async () => {
    const { configureEvent } = await open(london)

    await act(async () => {
      configureEvent.next()
    })

    expect(owmCalls()).toHaveLength(1)
  })

  it('asks again once the cached reading is stale', async () => {
    window.localStorage.setItem('weather-2643743', JSON.stringify({ ...makeReading(), timestamp: new Date(Date.now() - 21 * 60 * 1000).toISOString() }))

    await open(london)

    // Twenty minutes is the cache window, so this one is past it
    expect(owmCalls()).toHaveLength(1)
  })

  it('ignores a cached entry with no timestamp', async () => {
    window.localStorage.setItem('weather-2643743', JSON.stringify(makeReading()))

    await open(london)

    expect(owmCalls()).toHaveLength(1)
  })

  it('survives unreadable cached data', async () => {
    window.localStorage.setItem('weather-2643743', 'not json at all')

    await open(london)

    // A widget that throws here would take the whole dashboard down with it
    expect(owmCalls()).toHaveLength(1)
  })

  it('caches per location, not globally', async () => {
    window.localStorage.setItem('weather-2643743', JSON.stringify({ ...makeReading(), timestamp: new Date().toISOString() }))

    await open({ location: { id: 2988507, name: 'Paris' } })

    // Two weather widgets for different cities are a normal setup
    expect(owmCalls()).toHaveLength(1)
  })

  it('translates the icon codes into icons', async () => {
    reading = makeReading('01n')
    const { container } = await open(london)

    // The night variants matter: a sun icon at midnight looks like a bug
    expect(icon(container)).toBe('primary-text far fa-moon')
  })

  it('falls back to a plain cloud for an unknown code', async () => {
    reading = makeReading('99z')
    const { container } = await open(london)

    expect(icon(container)).toBe('primary-text fas fa-cloud')
  })

  /**
   * Every icon code OpenWeatherMap sends, and the Font Awesome icon it becomes.
   *
   * ⚠️ The day and night variants are the point: a sun icon at midnight reads as
   * a bug, and several codes deliberately share one icon (broken and scattered
   * cloud both show the same thing), so the pairs cannot be derived — they have
   * to be listed.
   */
  it.each([
    ['01d', 'far fa-sun'],
    ['01n', 'far fa-moon'],
    ['02d', 'fas fa-cloud-sun'],
    ['02n', 'fas fa-cloud-moon'],
    ['03d', 'fas fa-cloud-sun'],
    ['03n', 'fas fa-cloud-moon'],
    ['04d', 'fas fa-cloud-sun'],
    ['04n', 'fas fa-cloud-moon'],
    ['09d', 'fas fa-cloud-sun-rain'],
    ['09n', 'fas fa-cloud-moon-rain'],
    ['10d', 'fas fa-cloud-rain'],
    ['10n', 'fas fa-cloud-moon-rain'],
    ['11d', 'fas fa-cloud-showers-heavy'],
    ['11n', 'fas fa-cloud-showers-heavy'],
    ['13d', 'fas fa-snowflake'],
    ['13n', 'fas fa-snowflake'],
    ['50d', 'fas fa-smog'],
    ['50n', 'fas fa-smog'],
  ])('shows %s as %s', (code, expected) => {
    expect(getWeatherIconClass(code)).toBe(expected)
  })

  it('shows a cloud when there is no reading at all', () => {
    expect(getWeatherIconClass(undefined)).toBe('fas fa-cloud')
  })

  it('reads the temperature units from the settings', async () => {
    const { container } = await open(london, { env: { temperatureUnits: 'f' } })

    expect(container.querySelector('.weather-now h2')).toHaveTextContent('64°F')
  })
})
