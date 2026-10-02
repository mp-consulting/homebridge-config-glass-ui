import type { CharSpec } from '@/core/accessories/types/hap/hap.spec-helpers'
import type { FakeOpenModal } from '@/testing'

import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AIR_QUALITY_LABELS } from '@/core/accessories/types/hap/air-quality-sensor/air-quality-sensor.utils'
import { AirQualitySensorTile } from '@/core/accessories/types/hap/air-quality-sensor/AirQualitySensorTile'
import { BatteryTile } from '@/core/accessories/types/hap/battery/BatteryTile'
import { CarbonDioxideSensorTile } from '@/core/accessories/types/hap/carbon-dioxide-sensor/CarbonDioxideSensorTile'
import { CarbonMonoxideSensorTile } from '@/core/accessories/types/hap/carbon-monoxide-sensor/CarbonMonoxideSensorTile'
import { ContactSensorTile } from '@/core/accessories/types/hap/contact-sensor/ContactSensorTile'
import { renderTile, serviceWith } from '@/core/accessories/types/hap/hap.spec-helpers'
import { HumiditySensorTile } from '@/core/accessories/types/hap/humidity-sensor/HumiditySensorTile'
import { LeakSensorTile } from '@/core/accessories/types/hap/leak-sensor/LeakSensorTile'
import { LightSensorTile } from '@/core/accessories/types/hap/light-sensor/LightSensorTile'
import { MotionSensorTile } from '@/core/accessories/types/hap/motion-sensor/MotionSensorTile'
import { OccupancySensorTile } from '@/core/accessories/types/hap/occupancy-sensor/OccupancySensorTile'
import { SmokeSensorTile } from '@/core/accessories/types/hap/smoke-sensor/SmokeSensorTile'
import { TemperatureSensorTile } from '@/core/accessories/types/hap/temperature-sensor/TemperatureSensorTile'
import { useSettingsStore } from '@/core/settings/settings.store'
import * as modalModule from '@/core/ui/modal'
import { characteristic, hapService, makeSettingsState } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

const modal = modalModule as unknown as FakeOpenModal

/**
 * The HAP sensor tiles (the HAP half of `types/sensor-tiles.spec.ts`, plus the
 * display-only sensors). Sensors write nothing; what matters is what they show
 * and announce.
 */
describe('the sensor tiles', () => {
  beforeEach(() => {
    modal.opened.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    useSettingsStore.setState(makeSettingsState())
  })

  const label = (container: HTMLElement) => container.querySelectorAll('.accessory-label')[1]
  const announced = (container: HTMLElement) => container.querySelector('[role="status"]')!.textContent?.trim()

  describe('the HAP air quality tile', () => {
    function sensor(values: Record<string, number> = {}) {
      return serviceWith(Object.entries({ AirQuality: 2, ...values }) as CharSpec[], 'AirQualitySensor')
    }

    it.each([
      ['fine particulates', 'PM2_5Density'],
      ['coarse particulates', 'PM10Density'],
      ['ozone', 'OzoneDensity'],
      ['nitrogen dioxide', 'NitrogenDioxideDensity'],
      ['sulphur dioxide', 'SulphurDioxideDensity'],
      ['volatile compounds', 'VOCDensity'],
    ])('offers its modal when the sensor reports %s', (_label, field) => {
      const view = renderTile(AirQualitySensorTile, sensor({ [field]: 12 }))

      expect(view.box()).toHaveAttribute('role', 'button')
      expect(view.box()).toHaveClass('cursor-pointer')
    })

    it('offers nothing to open when there is only an overall rating', () => {
      // The modal exists to show the individual readings; with none it would be
      // an empty panel
      const view = renderTile(AirQualitySensorTile, sensor())

      expect(view.box()).not.toHaveAttribute('role')
      expect(view.box()).not.toHaveAttribute('tabindex')
    })

    it('counts a reading of zero as a reading', () => {
      // Zero particulates is a real measurement, and a good one
      expect(renderTile(AirQualitySensorTile, sensor({ PM2_5Density: 0 })).box()).toHaveAttribute('role', 'button')
    })

    it('opens the modal on a long press', async () => {
      vi.useFakeTimers()
      await renderTile(AirQualitySensorTile, sensor({ PM2_5Density: 12 })).longPress()

      expect(modal.opened).toHaveLength(1)
      expect(modal.lastOpened()!.options?.backdrop).toBe('static')
    })

    it('opens it from the keyboard too', () => {
      const view = renderTile(AirQualitySensorTile, sensor({ PM2_5Density: 12 }))

      fireEvent.keyDown(view.box(), { key: 'Enter' })

      expect(modal.opened).toHaveLength(1)
    })

    it('opens nothing when there is nothing to show', async () => {
      vi.useFakeTimers()
      await renderTile(AirQualitySensorTile, sensor()).longPress()

      expect(modal.opened).toEqual([])
    })

    it('has a label for every rating HAP defines', () => {
      // 0 unknown through 5 poor
      expect(AIR_QUALITY_LABELS).toHaveLength(6)
    })

    it.each([
      [5, 'fill-red'],
      [4, 'fill-orange'],
      [1, 'fill-green'],
    ])('colours rating %s with %s', (aq, cls) => {
      const view = renderTile(AirQualitySensorTile, sensor({ AirQuality: aq }))

      expect(view.box()).toHaveClass(cls)
      expect(label(view.container).textContent?.trim()).toBe(AIR_QUALITY_LABELS[aq])
    })
  })

  describe('the temperature tile', () => {
    it('takes the unit from the user settings on a HAP sensor', () => {
      const service = hapService({
        type: 'TemperatureSensor',
        characteristics: [characteristic('CurrentTemperature', 20.5)],
      })

      useSettingsStore.setState(makeSettingsState({ env: { temperatureUnits: 'f' } }))
      const fahrenheit = renderTile(TemperatureSensorTile, service)
      expect(label(fahrenheit.container).textContent).toBe('68.9°F')
      fahrenheit.unmount()

      useSettingsStore.setState(makeSettingsState({ env: { temperatureUnits: 'c' } }))
      expect(label(renderTile(TemperatureSensorTile, service).container).textContent).toBe('20.5°C')
    })

    it('says when there is no reading', () => {
      expect(label(renderTile(TemperatureSensorTile, serviceWith([['Name', 'x']])).container).textContent).toBe('accessories.control.no_data')
    })
  })

  describe('the binary sensors', () => {
    it.each([
      ['contact', ContactSensorTile, 'ContactSensorState', 'accessories.core.contact_sensor', 'accessories.control.open', 'accessories.control.closed'],
      ['leak', LeakSensorTile, 'LeakDetected', 'accessories.core.leak_sensor', 'accessories.control.detected', 'accessories.control.not_detected'],
      ['motion', MotionSensorTile, 'MotionDetected', 'accessories.core.motion_sensor', 'accessories.control.detected', 'accessories.control.not_detected'],
      ['occupancy', OccupancySensorTile, 'OccupancyDetected', 'accessories.core.occupancy_sensor', 'accessories.control.detected', 'accessories.control.not_detected'],
      ['smoke', SmokeSensorTile, 'SmokeDetected', 'accessories.core.smoke_sensor', 'accessories.control.detected', 'accessories.control.not_detected'],
      ['carbon monoxide', CarbonMonoxideSensorTile, 'CarbonMonoxideDetected', 'accessories.core.carbon_monoxide_sensor', 'accessories.control.detected', 'accessories.control.not_detected'],
      ['carbon dioxide', CarbonDioxideSensorTile, 'CarbonDioxideDetected', 'accessories.core.carbon_dioxide_sensor', 'accessories.control.detected', 'accessories.control.not_detected'],
    ])('shows a %s sensor tripped and clear', (_name, tile, char, typeKey, onKey, offKey) => {
      const tripped = renderTile(tile, serviceWith([[char, 1]]))
      expect(tripped.box()).toHaveClass('accessory-on')
      expect(label(tripped.container)).toHaveClass('red-text')
      expect(label(tripped.container).textContent).toBe(onKey)
      expect(announced(tripped.container)).toBe(`Test Accessory, ${typeKey}, ${onKey}`)
      tripped.unmount()

      const clear = renderTile(tile, serviceWith([[char, 0]]))
      expect(clear.box()).not.toHaveClass('accessory-on')
      expect(label(clear.container)).toHaveClass('grey-text')
      expect(label(clear.container).textContent).toBe(offKey)
    })

    it('leaves the type out of the announcement when the name already says it', () => {
      const service = hapService({ serviceName: 'Hall accessories.core.motion_sensor', characteristics: [characteristic('MotionDetected', false)] })

      expect(announced(renderTile(MotionSensorTile, service).container)).toBe('Hall accessories.core.motion_sensor, accessories.control.not_detected')
    })
  })

  describe('the reading sensors', () => {
    it('shows the humidity', () => {
      const view = renderTile(HumiditySensorTile, serviceWith([['CurrentRelativeHumidity', 45]]))

      expect(label(view.container).textContent).toBe('45%')
      expect(announced(view.container)).toBe('Test Accessory, accessories.core.humidity_sensor, 45%')
    })

    it.each([
      [0.25, '0.3 lux'],
      [1234.4, '1,234 lux'],
    ])('shows a light level of %s as %s', (lux, text) => {
      expect(label(renderTile(LightSensorTile, serviceWith([['CurrentAmbientLightLevel', lux]])).container).textContent).toBe(text)
    })

    it.each([
      [HumiditySensorTile],
      [LightSensorTile],
    ])('says when there is no reading', (tile) => {
      expect(label(renderTile(tile, serviceWith([['Name', 'x']])).container).textContent).toBe('accessories.control.no_data')
    })
  })

  describe('the battery', () => {
    it.each([
      [[['BatteryLevel', 50], ['ChargingState', 0]], 'accessories.control.battery_notcharging'],
      [[['BatteryLevel', 50], ['ChargingState', 1]], 'accessories.control.battery_charging'],
      [[['BatteryLevel', 50], ['ChargingState', 2]], 'accessories.control.battery_notchargeable'],
      [[['BatteryLevel', 5], ['StatusLowBattery', 1]], 'accessories.control.battery_low'],
      [[['BatteryLevel', 80]], 'accessories.control.battery_charged'],
    ])('labels %j as %s', (chars, text) => {
      expect(label(renderTile(BatteryTile, serviceWith(chars as CharSpec[])).container).textContent).toBe(text)
    })

    it('fills the icon to the level, green while charging', () => {
      const view = renderTile(BatteryTile, serviceWith([['BatteryLevel', 50], ['ChargingState', 1]]))
      const fill = view.container.querySelector('rect')!

      expect(fill).toHaveAttribute('width', '14')
      expect(fill).toHaveAttribute('fill', '#4caf50')
      expect(view.box()).toHaveClass('accessory-on')
      expect(announced(view.container)).toBe('Test Accessory, accessories.core.battery, 50%, accessories.control.battery_charging')
    })

    it('shows a low battery in red', () => {
      const view = renderTile(BatteryTile, serviceWith([['BatteryLevel', 0]]))

      expect(label(view.container).querySelector('.red-text')?.textContent).toBe('accessories.control.battery_low')
    })
  })
})
