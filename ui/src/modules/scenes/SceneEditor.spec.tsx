import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activeModalStub, fakeApi, renderWithProviders } from '@/testing'

import { SceneEditor } from './SceneEditor'
import { parseSceneValue } from './scenes'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const accessories = [
  {
    uniqueId: 'lamp',
    serviceName: 'Lamp',
    serviceCharacteristics: [
      { type: 'On', description: 'On', format: 'bool', canWrite: true },
      { type: 'Brightness', description: 'Brightness', format: 'int', minValue: 0, maxValue: 100, canWrite: true },
      { type: 'Name', description: 'Name', format: 'string', canWrite: false },
    ],
  },
  { uniqueId: 'sensor', serviceName: 'Sensor', serviceCharacteristics: [{ type: 'CurrentTemperature', description: 'Temp', format: 'float', canWrite: false }] },
]

describe('the scene editor', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>

  async function open(scene?: any) {
    renderWithProviders(<SceneEditor activeModal={{ ...activeModal, update: vi.fn() }} scene={scene} />)
    await act(async () => {})
  }

  beforeEach(() => {
    api = fakeApi().respond('get', '/accessories', accessories).respond('get', '/scenes/automation', { location: { lat: 48.85, lon: 2.35, name: 'Paris' }, nextSunrise: '2026-10-05T05:50:00Z', nextSunset: '2026-10-04T17:15:00Z', characteristicTriggers: false })
    activeModal = activeModalStub()
  })

  it('builds a new scene from the writable characteristics and saves it', async () => {
    api.respond('post', '/scenes', (call: any) => ({ id: 'new', ...call.body }))
    await open()
    expect(screen.getByRole('button', { name: 'form.button_save' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('scenes.name'), { target: { value: 'Movie' } })
    fireEvent.click(screen.getByRole('button', { name: /scenes.add_action/ }))
    // Only accessories that can be controlled are offered
    expect([...screen.getByLabelText<HTMLSelectElement>('scenes.accessory').options].map(o => o.value)).toEqual(['lamp'])
    fireEvent.change(screen.getByLabelText('scenes.characteristic'), { target: { value: 'Brightness' } })
    fireEvent.change(screen.getByLabelText('scenes.value'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /scenes.add_trigger/ }))
    fireEvent.change(screen.getByLabelText('scenes.cron'), { target: { value: '0 21 * * 5' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    })

    expect(api.callsTo('post', '/scenes')[0].body).toEqual({
      name: 'Movie',
      actions: [{ uniqueId: 'lamp', characteristicType: 'Brightness', value: 30 }],
      triggers: [{ type: 'cron', cron: '0 21 * * 5', enabled: true }],
      conditions: [],
    })
    expect(activeModal.close).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }))
  })

  it('edits an existing scene in place', async () => {
    api.respond('put', '/scenes/abc', (call: any) => ({ id: 'abc', ...call.body }))
    await open({ id: 'abc', name: 'Night', actions: [{ uniqueId: 'lamp', characteristicType: 'On', value: true }], schedules: [] })

    fireEvent.change(screen.getByLabelText('scenes.value'), { target: { value: 'false' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    })

    expect(api.callsTo('put', '/scenes/abc')[0].body.actions).toEqual([{ uniqueId: 'lamp', characteristicType: 'On', value: false }])
  })

  it('reads an older scene\'s schedules as cron triggers', async () => {
    await open({ id: 'abc', name: 'Night', actions: [{ uniqueId: 'lamp', characteristicType: 'On', value: true }], schedules: [{ cron: '0 7 * * *', enabled: true }] })

    expect(screen.getByLabelText('scenes.cron')).toHaveValue('0 7 * * *')
  })

  it('adds a sunset trigger with an offset, showing the location', async () => {
    api.respond('post', '/scenes', (call: any) => ({ id: 'new', ...call.body }))
    await open()
    fireEvent.change(screen.getByLabelText('scenes.name'), { target: { value: 'Dusk' } })
    fireEvent.click(screen.getByRole('button', { name: /scenes.add_action/ }))
    fireEvent.click(screen.getByRole('button', { name: /scenes.add_trigger/ }))
    fireEvent.change(screen.getByLabelText('scenes.trigger_type'), { target: { value: 'sun' } })
    fireEvent.change(screen.getByLabelText('scenes.offset'), { target: { value: '-20' } })

    expect(screen.getByTestId('scene-sun-info')).toHaveTextContent('scenes.sun_location')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    })
    expect(api.callsTo('post', '/scenes')[0].body.triggers).toEqual([{ type: 'sun', event: 'sunset', offsetMinutes: -20, enabled: true }])
  })

  it('triggers on a readable characteristic and says it needs insecure mode', async () => {
    api.respond('post', '/scenes', (call: any) => ({ id: 'new', ...call.body }))
    await open()
    fireEvent.change(screen.getByLabelText('scenes.name'), { target: { value: 'Warm' } })
    fireEvent.click(screen.getByRole('button', { name: /scenes.add_action/ }))
    fireEvent.click(screen.getByRole('button', { name: /scenes.add_trigger/ }))
    fireEvent.change(screen.getByLabelText('scenes.trigger_type'), { target: { value: 'characteristic' } })

    const row = screen.getByTestId('scene-trigger')
    const accessorySelect = row.querySelector<HTMLSelectElement>('select[aria-label="scenes.accessory"]')!
    // Readable characteristics are offered too: the sensor
    fireEvent.change(accessorySelect, { target: { value: 'sensor' } })
    fireEvent.change(row.querySelector('select[aria-label="scenes.operator"]')!, { target: { value: 'gt' } })
    fireEvent.change(row.querySelector('input[aria-label="scenes.value"]')!, { target: { value: '25' } })
    expect(screen.getByTestId('scene-insecure-info')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    })
    expect(api.callsTo('post', '/scenes')[0].body.triggers).toEqual([{ type: 'characteristic', uniqueId: 'sensor', characteristicType: 'CurrentTemperature', operator: 'gt', value: 25, enabled: true }])
  })

  it('adds a time window condition', async () => {
    api.respond('post', '/scenes', (call: any) => ({ id: 'new', ...call.body }))
    await open()
    fireEvent.change(screen.getByLabelText('scenes.name'), { target: { value: 'Night light' } })
    fireEvent.click(screen.getByRole('button', { name: /scenes.add_action/ }))
    fireEvent.click(screen.getByRole('button', { name: /scenes.add_time_condition/ }))
    fireEvent.change(screen.getByLabelText('scenes.until_time'), { target: { value: '06:30' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    })
    expect(api.callsTo('post', '/scenes')[0].body.conditions).toEqual([{ type: 'time', after: 'sunset', before: '06:30' }])
  })

  it('types values by the characteristic format', () => {
    expect(parseSceneValue('true', 'bool')).toBe(true)
    expect(parseSceneValue('21.5', 'float')).toBe(21.5)
    expect(parseSceneValue('abc', 'uint8')).toBe(0)
    expect(parseSceneValue('hi', 'string')).toBe('hi')
  })
})
