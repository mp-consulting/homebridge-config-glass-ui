import type { FakeOpenModal } from '@/testing'

import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderTile } from '@/core/accessories/types/hap/hap.spec-helpers'
import { MatterAirQualitySensorTile } from '@/core/accessories/types/matter/air-quality-sensor/MatterAirQualitySensorTile'
import { MatterSmokeCoAlarmTile } from '@/core/accessories/types/matter/smoke-co-alarm/MatterSmokeCoAlarmTile'
import { MatterTemperatureSensorTile } from '@/core/accessories/types/matter/temperature-sensor/MatterTemperatureSensorTile'
import { useSettingsStore } from '@/core/settings/settings.store'
import * as modalModule from '@/core/ui/modal'
import { makeSettingsState, matterService } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

const modal = modalModule as unknown as FakeOpenModal

/**
 * The Matter sensor tiles (the Matter half of `types/sensor-tiles.spec.ts`).
 * The air quality tile decides whether it has anything worth opening a modal
 * for, the smoke/CO alarm works out which kind of alarm it actually is, and the
 * temperature tile has to read the user's unit.
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
  // The tile's screen reader text. It is not a live region: a dashboard of
  // tiles each announcing every sensor change would talk over the user
  const announced = (container: HTMLElement) => {
    expect(container.querySelector('[aria-live], [role="status"]')).toBeNull()
    return container.querySelector('.accessory-box > .visually-hidden')!.textContent?.trim()
  }

  describe('the matter air quality tile', () => {
    function sensor(clusters: Record<string, Record<string, unknown>> = {}) {
      return matterService({
        deviceType: 'AirQualitySensor',
        clusters: { airQuality: { airQuality: 2 }, ...clusters },
      })
    }

    it('offers its modal when the sensor reports a concentration', () => {
      const view = renderTile(MatterAirQualitySensorTile, sensor({ pm25ConcentrationMeasurement: { measuredValue: 12 } }))

      expect(view.box()).toHaveAttribute('role', 'button')
      expect(view.box()).toHaveClass('cursor-pointer')
    })

    it('offers nothing to open when there is only an overall rating', () => {
      const view = renderTile(MatterAirQualitySensorTile, sensor())

      expect(view.box()).not.toHaveAttribute('role')
      expect(view.box()).not.toHaveAttribute('tabindex')
    })

    it('opens the modal on a long press', async () => {
      vi.useFakeTimers()
      await renderTile(MatterAirQualitySensorTile, sensor({ pm25ConcentrationMeasurement: { measuredValue: 12 } })).longPress()

      expect(modal.opened).toHaveLength(1)
    })

    it('opens it from the keyboard too', () => {
      const view = renderTile(MatterAirQualitySensorTile, sensor({ pm25ConcentrationMeasurement: { measuredValue: 12 } }))

      fireEvent.keyDown(view.box(), { key: 'Enter' })

      expect(modal.opened).toHaveLength(1)
    })

    it('opens nothing when there is nothing to show', async () => {
      vi.useFakeTimers()
      await renderTile(MatterAirQualitySensorTile, sensor()).longPress()

      expect(modal.opened).toEqual([])
    })
  })

  describe('the matter smoke and carbon monoxide alarm', () => {
    /**
     * One alarm accessory. Which alarms it has is decided by which state
     * attributes the cluster carries, not by the device type.
     * @param options - which alarms the device reports
     * @param options.smoke - the smoke alarm state, if it has one
     * @param options.co - the carbon monoxide alarm state, if it has one
     */
    function alarm(options: { smoke?: number, co?: number } = {}) {
      const cluster: Record<string, unknown> = {}
      if (options.smoke !== undefined) {
        cluster.smokeState = options.smoke
      }
      if (options.co !== undefined) {
        cluster.coState = options.co
      }
      return matterService({ deviceType: 'SmokeCoAlarm', clusters: { smokeCoAlarm: cluster } })
    }

    const face = (container: HTMLElement) => container.querySelector('svg text.type')!.textContent

    it('calls a smoke-only device a smoke alarm', () => {
      const view = renderTile(MatterSmokeCoAlarmTile, alarm({ smoke: 0 }))

      expect(face(view.container)).toBe('SMOKE')
      expect(announced(view.container)).toContain('accessories.core.smoke_sensor')
    })

    it('calls a carbon-monoxide-only device a CO alarm', () => {
      // A plugin can register either alarm on its own, and calling a CO detector
      // a smoke alarm would be actively misleading
      const view = renderTile(MatterSmokeCoAlarmTile, alarm({ co: 0 }))

      expect(face(view.container)).toBe('CO')
      expect(announced(view.container)).toContain('accessories.core.carbon_monoxide_sensor')
    })

    it('keeps the generic face for a device with both', () => {
      expect(face(renderTile(MatterSmokeCoAlarmTile, alarm({ smoke: 0, co: 0 })).container)).toBe('ALARM')
    })

    it('labels a combined alarm as smoke rather than leaving it blank', () => {
      const view = renderTile(MatterSmokeCoAlarmTile, alarm({ smoke: 0, co: 0 }))

      expect(announced(view.container)).toContain('accessories.core.smoke_sensor')
    })

    it('falls back to smoke for a device claiming neither', () => {
      // Matter requires at least one, so this device is malformed - it arrived
      // under the SmokeSensor device type, so treat it as one
      expect(face(renderTile(MatterSmokeCoAlarmTile, alarm()).container)).toBe('SMOKE')
    })

    it('shows an alarm that is sounding as triggered', () => {
      const view = renderTile(MatterSmokeCoAlarmTile, alarm({ smoke: 1 }))

      expect(view.box()).toHaveClass('accessory-on')
      expect(label(view.container)).toHaveClass('red-text')
      expect(label(view.container).textContent).toBe('accessories.control.detected')
    })

    it('shows a quiet alarm as not triggered', () => {
      const view = renderTile(MatterSmokeCoAlarmTile, alarm({ smoke: 0 }))

      expect(view.box()).not.toHaveClass('accessory-on')
      expect(label(view.container)).toHaveClass('grey-text')
      expect(label(view.container).textContent).toBe('accessories.control.not_detected')
    })
  })

  describe('the matter temperature tile', () => {
    const service = () => matterService({
      deviceType: 'TemperatureSensor',
      clusters: { temperatureMeasurement: { measuredValue: 2050 } },
    })

    it('takes the unit from the user settings on a matter sensor', () => {
      useSettingsStore.setState(makeSettingsState({ env: { temperatureUnits: 'f' } }))

      expect(label(renderTile(MatterTemperatureSensorTile, service()).container).textContent).toBe('68.9°F')
    })

    it('reads a matter temperature out of hundredths of a degree', () => {
      useSettingsStore.setState(makeSettingsState({ env: { temperatureUnits: 'c' } }))

      expect(label(renderTile(MatterTemperatureSensorTile, service()).container).textContent).toBe('20.5°C')
    })
  })
})
