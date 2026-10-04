import type { FakeApi } from '@/testing'

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeApi } from '@/testing'

import { isRecordedCharacteristic, summarise } from './accessory-history'
import AccessoryHistoryPanel from './AccessoryHistoryPanel'

vi.mock('react-chartjs-2', () => ({ Line: () => <canvas /> }))

describe('the accessory history panel', () => {
  let api: FakeApi

  async function open() {
    const view = render(<AccessoryHistoryPanel uniqueId="abc" />)
    await act(async () => {})
    return view
  }

  beforeEach(() => {
    api = fakeApi()
  })

  it('draws a sparkline per recorded characteristic with its range', async () => {
    api.respond('get', /\/accessories\/abc\/history/, {
      uniqueId: 'abc',
      from: 0,
      to: 0,
      series: [
        { type: 'CurrentTemperature', description: 'Current Temperature', points: [[1, 19], [2, 23]] },
        // A single point is no line
        { type: 'BatteryLevel', description: 'Battery Level', points: [[1, 90]] },
      ],
    })
    await open()

    expect(api.callsTo('get')[0].url).toBe('/accessories/abc/history?hours=24&maxPoints=96')
    expect(screen.getByTestId('sparkline-CurrentTemperature')).toBeInTheDocument()
    expect(screen.queryByTestId('sparkline-BatteryLevel')).toBeNull()
    expect(screen.getByText('accessories.history.range')).toBeInTheDocument()
  })

  it('renders nothing without history, or when the server has none to give', async () => {
    api.fail('get', /\/accessories\/abc\/history/, { status: 404 })
    const { container } = await open()

    expect(container).toBeEmptyDOMElement()
  })

  it('knows which characteristics are recorded', () => {
    expect(isRecordedCharacteristic({ type: 'CurrentTemperature', format: 'float' })).toBe(true)
    expect(isRecordedCharacteristic({ type: 'X', description: 'Total Consumption', format: 'float' })).toBe(true)
    expect(isRecordedCharacteristic({ type: 'On', format: 'bool' })).toBe(false)
    expect(summarise([])).toBeNull()
    expect(summarise([[1, 3], [2, 1], [3, 2]])).toEqual({ latest: 2, min: 1, max: 3 })
  })
})
