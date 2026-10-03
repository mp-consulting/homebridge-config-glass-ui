import { describe, expect, it } from 'vitest'

import { convertTemp } from '@/core/pipes/convert-temp'
import { useSettingsStore } from '@/core/settings/settings.store'

describe('convertTemp', () => {
  function setUnits(temperatureUnits: 'c' | 'f') {
    useSettingsStore.setState(state => ({ env: { ...state.env, temperatureUnits } }))
  }

  it('rounds celsius values to one decimal place', () => {
    setUnits('c')
    expect(convertTemp(21.5)).toBe(21.5)
    expect(convertTemp(21.44)).toBe(21.4)
  })

  it('converts to fahrenheit when the settings unit is f', () => {
    setUnits('f')
    expect(convertTemp(0)).toBe(32)
    expect(convertTemp(100)).toBe(212)
    expect(convertTemp(21)).toBe(69.8)
  })

  it('lets an explicit unit argument override the settings', () => {
    setUnits('c')
    expect(convertTemp(0, 'f')).toBe(32)
  })
})
