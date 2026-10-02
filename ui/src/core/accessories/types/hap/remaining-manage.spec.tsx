import type { CharSpec } from '@/core/accessories/types/hap/hap.spec-helpers'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AIR_QUALITY_LABELS } from '@/core/accessories/types/hap/air-quality-sensor/air-quality-sensor.utils'
import { AirQualitySensorManage } from '@/core/accessories/types/hap/air-quality-sensor/AirQualitySensorManage'
import { FilterMaintenanceManage } from '@/core/accessories/types/hap/filter-maintenance/FilterMaintenanceManage'
import { GarageDoorOpenerManage } from '@/core/accessories/types/hap/garage-door-opener/GarageDoorOpenerManage'
import { clickButton, renderManage, serviceWith as tileService, writesTo } from '@/core/accessories/types/hap/hap.spec-helpers'
import { securityTransition } from '@/core/accessories/types/hap/security-system/security-system.utils'
import { SecuritySystemManage } from '@/core/accessories/types/hap/security-system/SecuritySystemManage'
import { TelevisionManage } from '@/core/accessories/types/hap/television/TelevisionManage'
import { characteristic, hapService } from '@/testing'

/** The remaining HAP manage modals: the ones with a state machine or a list of their own. */
describe('the remaining HAP manage modals', () => {
  /** A service carrying exactly the characteristics a case names. */
  function serviceWith(type: string, chars: CharSpec[]) {
    return tileService(chars, type)
  }

  /** The option shown as selected (aria-pressed, or the check-circle icon). */
  function selected(container: HTMLElement) {
    return [...container.querySelectorAll('.btn-control')]
      .filter(b => b.querySelector('.fa-check-circle'))
      .map(b => b.textContent?.trim())
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(console.error).mockRestore()
  })

  describe('garage door opener', () => {
    function garage(currentState: number) {
      return serviceWith('GarageDoorOpener', [
        ['CurrentDoorState', currentState],
        ['TargetDoorState', 1],
      ])
    }

    it.each([
      ['open', 0, ['accessories.control.open']],
      ['closed', 1, ['accessories.control.close']],
      ['opening', 2, []],
      ['closing', 3, []],
    ])('shows a door that is %s as it is', (_label, currentState, expected) => {
      // While moving, the target is 2 or 3 and neither button is checked
      const { container } = renderManage(GarageDoorOpenerManage, garage(currentState))

      expect(selected(container)).toEqual(expected)
    })

    it('shows a door stopped while closing as heading open', () => {
      // A stopped door reports no direction, so the modal has to remember which
      // way it was going - and the button it then offers is the reverse
      const view = renderManage(GarageDoorOpenerManage, garage(3))

      view.pushUpdate(garage(4))

      expect(selected(view.container)).toEqual(['accessories.control.open'])
      expect(view.container.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('accessories.control.open')
    })

    it('shows a door stopped while opening as heading closed', () => {
      const view = renderManage(GarageDoorOpenerManage, garage(2))

      view.pushUpdate(garage(4))

      expect(selected(view.container)).toEqual(['accessories.control.close'])
    })

    it('shows a door stopped before it ever moved as stopped', () => {
      // Nothing to reverse
      const { container } = renderManage(GarageDoorOpenerManage, garage(4))

      expect(selected(container)).toEqual([])
      expect(container.querySelector('.btn-read')?.textContent).toBe('accessories.control.stopped')
    })

    it('writes the button straight to TargetDoorState', () => {
      const service = garage(1)
      const { container } = renderManage(GarageDoorOpenerManage, service)

      clickButton(container, 'accessories.control.open')

      expect(writesTo(service)).toEqual([{ type: 'TargetDoorState', value: 0 }])
    })

    it('says when the door is obstructed', () => {
      const { container } = renderManage(GarageDoorOpenerManage, serviceWith('GarageDoorOpener', [
        ['CurrentDoorState', 0],
        ['TargetDoorState', 0],
        ['ObstructionDetected', true],
      ]))

      expect(container.querySelector('.btn-read')?.textContent).toBe('accessories.control.open (accessories.control.obstructed)')
    })
  })
  describe('security system', () => {
    function alarm(current: number, target: number, validValues = [0, 1, 2, 3]) {
      return serviceWith('SecuritySystem', [
        ['SecuritySystemCurrentState', current],
        ['SecuritySystemTargetState', target, { validValues }],
      ])
    }

    const status = (container: HTMLElement) => container.querySelector('.btn-read')!.textContent

    it('reads the mode the system is heading for', () => {
      const { container } = renderManage(SecuritySystemManage, alarm(3, 1))

      expect(selected(container)).toEqual(['accessories.control.away'])
    })

    it('offers only the modes the system supports', () => {
      const { container } = renderManage(SecuritySystemManage, alarm(3, 3, [0, 3]))

      expect([...container.querySelectorAll('.btn-control')].map(b => b.textContent?.trim())).toEqual([
        'accessories.control.off',
        'accessories.control.home',
      ])
    })

    it('writes the mode buttons to SecuritySystemTargetState', () => {
      const service = alarm(3, 3)
      const { container } = renderManage(SecuritySystemManage, service)

      clickButton(container, 'accessories.control.away')

      expect(writesTo(service)).toEqual([{ type: 'SecuritySystemTargetState', value: 1 }])
      expect(selected(container)).toEqual(['accessories.control.away'])
    })

    it('shows nothing in progress once it has settled', () => {
      expect(status(renderManage(SecuritySystemManage, alarm(1, 1)).container)).toBe('accessories.control.ready')
    })

    it('shows it arming while it moves towards an armed mode', () => {
      // Current 3 is disarmed, target 1 is armed away
      expect(status(renderManage(SecuritySystemManage, alarm(3, 1)).container)).toBe('accessories.control.arming...')
    })

    it('shows it disarming while it moves towards disarmed', () => {
      expect(status(renderManage(SecuritySystemManage, alarm(1, 3)).container)).toBe('accessories.control.disarming...')
    })

    it('shows neither while a triggered alarm is being disarmed', () => {
      // Current 4 is triggered; the transition indicators would be misleading
      const { container } = renderManage(SecuritySystemManage, alarm(4, 3))

      expect(status(container)).toBe('accessories.control.triggered')
      expect(container.querySelector('.btn-read')).toHaveClass('text-danger')
      expect(container.querySelector('.fa-check-circle')).toHaveClass('opacity-muted')
    })

    it('shows neither while a triggered alarm is being re-armed', () => {
      // ⚠️ Needs a target other than 3: with target 3 the `isArming` expression
      // is already false on its own, so the triggered-state guard it also
      // carries goes unexercised
      expect(securityTransition(alarm(4, 1))).toEqual({ isArming: false, isDisarming: false })
    })

    it('shows a disarmed system as off', () => {
      expect(status(renderManage(SecuritySystemManage, alarm(3, 3)).container)).toBe('accessories.control.off')
    })
  })
  describe('television', () => {
    /** A television, optionally with input sources linked beside it. */
    function television(options: { active?: number, inputs?: Array<[number, string | undefined]> } = {}) {
      const tv = serviceWith('Television', [
        ['Active', options.active ?? 1],
        ['ActiveIdentifier', 1],
      ])

      if (options.inputs) {
        tv.linkedServices = Object.fromEntries(options.inputs.map(([identifier, name], index) => [
          20 + index,
          hapService({
            type: 'InputSource',
            uniqueId: `hap-input-${identifier}`,
            characteristics: [
              characteristic('Identifier', identifier),
              ...(name === undefined ? [] : [characteristic('ConfiguredName', name)]),
            ],
          }) as any,
        ]))
      }

      return tv
    }

    const inputs = (container: HTMLElement) => [...container.querySelectorAll('[aria-label="accessories.control.input_control"] .btn-control')].map(b => b.textContent?.trim())

    it('offers the power buttons only to a television that has them', () => {
      expect(renderManage(TelevisionManage, television({ active: 1 })).container.textContent).toContain('accessories.control.off')

      const noPower = serviceWith('Television', [['ActiveIdentifier', 1]])
      expect(renderManage(TelevisionManage, noPower).container.textContent).not.toContain('accessories.control.off')
    })

    it('writes the power buttons to Active', () => {
      const service = television()
      const { container } = renderManage(TelevisionManage, service)

      clickButton(container, 'accessories.control.off')

      expect(writesTo(service)).toEqual([{ type: 'Active', value: 0 }])
    })

    it('writes an input choice to ActiveIdentifier', () => {
      // Not to Active - the two are one keystroke apart
      const service = television({ inputs: [[1, 'HDMI 1'], [3, 'Apple TV']] })
      const { container } = renderManage(TelevisionManage, service)

      clickButton(container, 'Apple TV')

      expect(writesTo(service)).toEqual([{ type: 'ActiveIdentifier', value: 3 }])
    })

    it('builds the input list from the linked input sources', () => {
      const { container } = renderManage(TelevisionManage, television({
        inputs: [[1, 'HDMI 1'], [2, 'Apple TV']],
      }))

      expect(inputs(container)).toEqual(['HDMI 1', 'Apple TV'])
      expect(selected(container)).toContain('HDMI 1')
      expect(container.querySelector('h6')!.textContent).toBe('accessories.control.input')
    })

    it('names an unnamed input after its number', () => {
      // Rather than showing a blank row the user cannot identify
      const { container } = renderManage(TelevisionManage, television({ inputs: [[4, undefined]] }))

      expect(inputs(container)).toEqual(['Input 4'])
    })

    it('offers no input list on a television with none linked', () => {
      const { container } = renderManage(TelevisionManage, television())

      expect(inputs(container)).toEqual([])
      expect(container.querySelector('[aria-label="accessories.control.mode_control"]')).toHaveClass('mb-0')
    })

    it('ignores a linked service that is not an input source', () => {
      const tv = television()
      tv.linkedServices = { 20: hapService({ type: 'TelevisionSpeaker', uniqueId: 'hap-speaker' }) as any }
      const { container } = renderManage(TelevisionManage, tv)

      expect(inputs(container)).toEqual([])
    })
  })
  describe('air quality sensor', () => {
    function sensor(values: Record<string, number> = {}) {
      return serviceWith('AirQualitySensor', Object.entries({ AirQuality: 2, ...values }) as CharSpec[])
    }

    const badge = (container: HTMLElement) => container.querySelector('.badge')!
    const readings = (container: HTMLElement) => [...container.querySelectorAll('.list-group-item')].map(li => li.textContent)

    it('reads the overall air quality', () => {
      const { container } = renderManage(AirQualitySensorManage, sensor({ AirQuality: 4 }))

      expect(badge(container).textContent).toBe('accessories.control.air_quality_inferior')
      expect(badge(container)).toHaveClass('bg-warning')
    })

    it('reads an unreported air quality as unknown rather than good', () => {
      const { container } = renderManage(AirQualitySensorManage, serviceWith('AirQualitySensor', [['PM2_5Density', 12]]))

      expect(badge(container).textContent).toBe('accessories.control.air_quality_unknown')
    })

    it('reads each concentration the sensor reports', () => {
      const { container } = renderManage(AirQualitySensorManage, sensor({
        PM2_5Density: 12,
        PM10Density: 20,
        OzoneDensity: 30,
        NitrogenDioxideDensity: 5,
      }))

      expect(readings(container)).toEqual([
        'accessories.control.pm2512 µg/m³',
        'accessories.control.pm1020 µg/m³',
        'accessories.control.ozone30 µg/m³',
        'accessories.control.nitrogen_dioxide5 µg/m³',
      ])
    })

    it('leaves a concentration the sensor does not report as unknown', () => {
      // Rather than zero, which reads as a clean measurement
      const { container } = renderManage(AirQualitySensorManage, sensor())

      expect(container.querySelector('.list-group')).toBeNull()
    })

    it('lists a reading of zero', () => {
      expect(readings(renderManage(AirQualitySensorManage, sensor({ VOCDensity: 0 })).container)).toEqual(['accessories.control.voc0 µg/m³'])
    })

    it('has a label for every air quality level HAP defines', () => {
      // 0 unknown through 5 poor
      expect(AIR_QUALITY_LABELS).toHaveLength(6)
    })

    it('follows a change made elsewhere', () => {
      const view = renderManage(AirQualitySensorManage, sensor({ PM2_5Density: 12 }))

      view.pushUpdate(sensor({ AirQuality: 5, PM2_5Density: 90 }))

      expect(badge(view.container)).toHaveClass('bg-danger')
      expect(readings(view.container)).toEqual(['accessories.control.pm2590 µg/m³'])
    })
  })
  describe('filter maintenance', () => {
    it('writes one to ResetFilterIndication, the only value HAP accepts', () => {
      const service = serviceWith('FilterMaintenance', [
        ['FilterChangeIndication', 1],
        ['FilterLifeLevel', 5],
        ['ResetFilterIndication', 0],
      ])
      const { container } = renderManage(FilterMaintenanceManage, service)

      clickButton(container, 'form.button_reset')

      expect(writesTo(service)).toEqual([{ type: 'ResetFilterIndication', value: 1 }])
    })

    it('shows the level on a slider the user cannot move, kept live', () => {
      const view = renderManage(FilterMaintenanceManage, serviceWith('FilterMaintenance', [['FilterLifeLevel', 5]]))

      expect(view.container.querySelector('.noUi-target')).toHaveAttribute('disabled', 'true')
      expect(view.container.querySelector('h6')!.textContent).toBe('accessories.control.filter_level: 5%')

      view.pushUpdate(serviceWith('FilterMaintenance', [['FilterLifeLevel', 100]]))

      expect(view.container.querySelector('h6')!.textContent).toBe('accessories.control.filter_level: 100%')
    })
  })
})
