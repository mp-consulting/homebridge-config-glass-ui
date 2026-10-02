import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DoorManage } from '@/core/accessories/types/hap/door/DoorManage'
import { DoorbellManage } from '@/core/accessories/types/hap/doorbell/DoorbellManage'
import { FanManage } from '@/core/accessories/types/hap/fan/FanManage'
import { clickButton, flushDebounce, isChecked, renderManage, sliderApi, slideTo, writesTo } from '@/core/accessories/types/hap/hap.spec-helpers'
import { LockMechanismManage } from '@/core/accessories/types/hap/lock-mechanism/LockMechanismManage'
import { MicrophoneManage } from '@/core/accessories/types/hap/microphone/MicrophoneManage'
import { SpeakerManage } from '@/core/accessories/types/hap/speaker/SpeakerManage'
import { ValveManage } from '@/core/accessories/types/hap/valve/ValveManage'
import { WindowCoveringManage } from '@/core/accessories/types/hap/window-covering/WindowCoveringManage'
import { WindowManage } from '@/core/accessories/types/hap/window/WindowManage'
import { duration } from '@/core/pipes/duration'
import { characteristic, hapService } from '@/testing'

/**
 * The simple HAP manage modals: one or two controls each, written straight to
 * a characteristic. The controls are driven through the DOM (buttons, the
 * noUiSlider API) and the 500ms debounce of `useManageAccessory`.
 */
describe('the simple HAP manage modals', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the fan modal', () => {
    /** A Fan (v1) accessory, which reports power as a boolean `On`. */
    function fanV1(on = true, speed = 50) {
      return hapService({
        type: 'Fan',
        characteristics: [
          characteristic('On', on),
          characteristic('RotationSpeed', speed, { minValue: 0, maxValue: 100, minStep: 1 }),
          characteristic('RotationDirection', 0),
        ],
      })
    }

    /** A Fanv2 accessory, which reports power as a numeric `Active`. */
    function fanV2(active = 1, speed = 50) {
      return hapService({
        type: 'Fanv2',
        characteristics: [
          characteristic('Active', active),
          characteristic('RotationSpeed', speed, { minValue: 0, maxValue: 100, minStep: 1 }),
        ],
      })
    }

    const isOn = (service: ReturnType<typeof fanV1>) => isChecked(renderManage(FanManage, service).container, 'accessories.control.on')

    it('reads a v1 fan as on from its boolean', () => {
      expect(isOn(fanV1(true))).toBe(true)
      expect(isOn(fanV1(false))).toBe(false)
    })

    it('reads a v2 fan as on from its numeric active state', () => {
      expect(isOn(fanV2(1))).toBe(true)
      expect(isOn(fanV2(0))).toBe(false)
    })

    it('treats an out-of-spec active value as off', () => {
      // HAP only defines 0 and 1 here, so the two cases above pass whether the
      // check is `=== 1` or merely truthy. This one pins the strict reading:
      // a plugin reporting something else is treated as off rather than on
      expect(isOn(fanV2(2))).toBe(false)
    })

    it('writes a boolean to On for a v1 fan', () => {
      const service = fanV1(false)
      const { container } = renderManage(FanManage, service)

      clickButton(container, 'accessories.control.on')

      expect(writesTo(service)).toEqual([{ type: 'On', value: true }])
    })

    it('writes a number to Active for a v2 fan', () => {
      // A boolean here is rejected by HAP as the wrong format
      const service = fanV2(0)
      const { container } = renderManage(FanManage, service)

      clickButton(container, 'accessories.control.on')

      expect(writesTo(service)).toEqual([{ type: 'Active', value: 1 }])
    })

    it('writes zero rather than false when a v2 fan is switched off', () => {
      const service = fanV2(1)
      const { container } = renderManage(FanManage, service)

      clickButton(container, 'accessories.control.off')

      expect(writesTo(service)).toEqual([{ type: 'Active', value: 0 }])
    })

    it.each([
      ['switches the fan on when the speed is raised off zero', () => fanV1(false, 0), 40, { type: 'On', value: true }],
      ['switches the fan off when the speed is dragged to zero', () => fanV1(true, 50), 0, { type: 'On', value: false }],
      // ⚠️ The v1 cases above go through the `On` arm. A v2 fan takes the `Active`
      // arm right beside it, and a boolean written there is refused by HAP - so
      // the speed would move and the fan would stay off
      ['switches a v2 fan on with a number when the speed is raised off zero', () => fanV2(0, 0), 40, { type: 'Active', value: 1 }],
      ['switches a v2 fan off with a zero when the speed is dragged to zero', () => fanV2(1, 50), 0, { type: 'Active', value: 0 }],
    ])('%s', async (_label, make, speed, power) => {
      const service = make()
      const { container } = renderManage(FanManage, service)

      slideTo(container, '', speed)
      await flushDebounce()

      expect(writesTo(service)).toEqual([{ type: 'RotationSpeed', value: speed }, power])
    })

    it.each([
      ['a v1 fan', () => fanV1(true, 50), () => fanV1(false, 20)],
      ['a v2 fan', () => fanV2(1, 50), () => fanV2(0, 20)],
    ])('follows a change made elsewhere on %s', (_case, initial, changed) => {
      const view = renderManage(FanManage, initial())

      view.pushUpdate(changed())

      expect(isChecked(view.container, 'accessories.control.off')).toBe(true)
      expect(sliderApi(view.container)!.get()).toBe('20')
    })

    it('does not touch the power when the fan is already in the right state', async () => {
      const service = fanV1(true, 50)
      const { container } = renderManage(FanManage, service)

      slideTo(container, '', 90)
      await flushDebounce()

      expect(writesTo(service)).toEqual([{ type: 'RotationSpeed', value: 90 }])
    })

    it('moves the slider to full when switching on a fan sitting at zero', () => {
      const service = fanV1(false, 0)
      const { container } = renderManage(FanManage, service)

      clickButton(container, 'accessories.control.on')

      expect(sliderApi(container)!.get()).toBe('100')
    })

    it('offers the direction control only to a fan that has one', () => {
      expect(renderManage(FanManage, fanV1()).container.textContent).toContain('accessories.control.rotation_direction')
      expect(renderManage(FanManage, fanV2()).container.textContent).not.toContain('accessories.control.rotation_direction')
    })

    it('writes the direction to RotationDirection', () => {
      const service = fanV1()
      const { container } = renderManage(FanManage, service)

      clickButton(container, 'accessories.control.rotation_c_clockwise')

      expect(writesTo(service)).toEqual([{ type: 'RotationDirection', value: 1 }])
    })
  })
  // door, window and window-covering are three copies of the same modal
  describe.each([
    ['door', DoorManage],
    ['window', WindowManage],
    ['window covering', WindowCoveringManage],
  ])('the %s modal', (_name, type) => {
    function positionService(current = 40, target = 40) {
      return hapService({
        type: 'Door',
        characteristics: [
          characteristic('CurrentPosition', current, { minValue: 0, maxValue: 100, minStep: 1 }),
          characteristic('TargetPosition', target, { minValue: 0, maxValue: 100, minStep: 1 }),
          characteristic('PositionState', 2),
        ],
      })
    }

    /** The target slider (the first; the second is the read-only current position). */
    const target = (container: HTMLElement) => sliderApi(container)!

    it('reads the slider range off the characteristic', () => {
      const service = hapService({
        type: 'Door',
        characteristics: [
          characteristic('CurrentPosition', 40),
          characteristic('TargetPosition', 40, { minValue: 0, maxValue: 100, minStep: 5 }),
        ],
      })
      const { container } = renderManage(type, service)

      expect(target(container).get()).toBe('40')
      expect(target(container).options.range).toEqual({ min: 0, max: 100 })
      expect(target(container).options.step).toBe(5)
    })

    it('shows the current position on a slider the user cannot move', () => {
      const { container } = renderManage(type, positionService(30, 40))

      const current = container.querySelectorAll('.noUi-target')[1]
      expect(current).toHaveAttribute('disabled', 'true')
      expect(container.textContent).toContain('accessories.control.current: 30%')
      expect(container.querySelector('.btn-read')!.textContent).toBe('accessories.control.open 30%')
    })

    it('writes the new position to TargetPosition', async () => {
      const service = positionService()
      const { container } = renderManage(type, service)

      act(() => target(container).set(80))
      await flushDebounce()

      expect(writesTo(service)).toEqual([{ type: 'TargetPosition', value: 80 }])
    })

    it('shows it as opening while it moves towards the new position', async () => {
      // The accessory reports PositionState itself, but not until it starts
      // moving - without this the tile shows nothing happening
      const service = positionService(40, 40)
      const { container } = renderManage(type, service)

      act(() => target(container).set(80))
      await flushDebounce()

      expect(service.values.PositionState).toBe(1)
      expect(container.querySelector('.btn-read')!.textContent).toBe('accessories.control.opening...')
    })

    it('shows it as closing while it moves the other way', async () => {
      const service = positionService(40, 40)
      const { container } = renderManage(type, service)

      act(() => target(container).set(10))
      await flushDebounce()

      expect(service.values.PositionState).toBe(0)
    })

    it('leaves the state alone when the position has not changed', async () => {
      const service = positionService(40, 40)
      const { container } = renderManage(type, service)

      act(() => {
        target(container).set(60)
        target(container).set(40)
      })
      await flushDebounce()

      expect(service.values.PositionState).toBe(2)
    })

    it('follows a position change made elsewhere', () => {
      const view = renderManage(type, positionService())

      view.pushUpdate(positionService(70, 70))

      expect(target(view.container).get()).toBe('70')
    })
  })

  it('announces the door state to a screen reader', () => {
    const { container } = renderManage(DoorManage, hapService({
      type: 'Door',
      characteristics: [characteristic('CurrentPosition', 0), characteristic('TargetPosition', 0, { minValue: 0, maxValue: 100, minStep: 1 }), characteristic('PositionState', 2)],
    }))

    expect(container.querySelector('.btn-read')).toHaveAttribute('role', 'status')
  })

  /**
   * Blinds that also tilt.
   *
   * ⚠️ **The two axes are separate characteristics and only some blinds have
   * either.** A slider written to the wrong axis turns the slats the wrong way,
   * and one offered for an axis the blind does not have writes nowhere at all.
   */
  describe('the window covering tilt controls', () => {
    /** A blind, with whichever tilt axes it is given. */
    function blind(axes: { horizontal?: number, vertical?: number } = {}) {
      const characteristics = [
        characteristic('CurrentPosition', 40, { minValue: 0, maxValue: 100, minStep: 1 }),
        characteristic('TargetPosition', 40, { minValue: 0, maxValue: 100, minStep: 1 }),
        characteristic('PositionState', 2),
      ]

      if (axes.horizontal !== undefined) {
        characteristics.push(characteristic('TargetHorizontalTiltAngle', axes.horizontal, { minValue: -90, maxValue: 90, minStep: 1 }))
      }
      if (axes.vertical !== undefined) {
        characteristics.push(characteristic('TargetVerticalTiltAngle', axes.vertical, { minValue: -90, maxValue: 90, minStep: 1 }))
      }

      return hapService({ type: 'WindowCovering', characteristics })
    }

    /** The tilt sliders come after the two position ones, target then current per axis. */
    const sliders = (container: HTMLElement) => [...container.querySelectorAll('.noUi-target')].map(el => (el as any).noUiSlider)

    it.each([
      ['horizontal', { horizontal: 0 }, 'TargetHorizontalTiltAngle'],
      ['vertical', { vertical: 0 }, 'TargetVerticalTiltAngle'],
    ])('writes the %s slider to its own characteristic', async (_case, axes, type) => {
      const service = blind(axes)
      const { container } = renderManage(WindowCoveringManage, service)

      act(() => sliders(container)[2].set(45))
      await flushDebounce()

      expect(writesTo(service)).toEqual([{ type, value: 45 }])
    })

    it('keeps the two axes apart on a blind that has both', async () => {
      // ⚠️ One slider writing both would twist the slats on an axis the user
      // never touched
      const service = blind({ horizontal: 0, vertical: 0 })
      const { container } = renderManage(WindowCoveringManage, service)

      act(() => sliders(container)[2].set(30))
      await flushDebounce()

      expect(writesTo(service)).toEqual([{ type: 'TargetHorizontalTiltAngle', value: 30 }])
    })

    it('takes the slider bounds from the accessory, not the full tilt range', () => {
      const service = hapService({
        type: 'WindowCovering',
        characteristics: [
          characteristic('CurrentPosition', 40),
          characteristic('TargetPosition', 40, { minValue: 0, maxValue: 100, minStep: 1 }),
          characteristic('TargetHorizontalTiltAngle', 0, { minValue: 0, maxValue: 90, minStep: 5 }),
        ],
      })

      const { container } = renderManage(WindowCoveringManage, service)

      expect(sliders(container)[2].options.range).toEqual({ min: 0, max: 90 })
      expect(sliders(container)[2].options.step).toBe(5)
    })

    it('offers no tilt slider on a blind that does not tilt', () => {
      const { container } = renderManage(WindowCoveringManage, blind())

      expect(sliders(container)).toHaveLength(2)
    })

    it('offers no tilt slider on a door or window, whatever it reports', () => {
      const { container } = renderManage(WindowManage, blind({ horizontal: 0 }))

      expect(sliders(container)).toHaveLength(2)
    })

    it('follows a tilt change made elsewhere', () => {
      const view = renderManage(WindowCoveringManage, blind({ horizontal: 0, vertical: 0 }))

      view.pushUpdate(blind({ horizontal: 60, vertical: -30 }))

      // No current tilt is reported, so those two sliders wait for a value and the targets sit side by side
      expect(sliders(view.container)[2].get()).toBe('60')
      expect(sliders(view.container)[3].get()).toBe('-30')
    })

    it('copes with an update on a blind that has no tilt', () => {
      const view = renderManage(WindowCoveringManage, blind())

      expect(() => view.pushUpdate(blind())).not.toThrow()
    })
  })
  describe('the lock modal', () => {
    /** A lock, optionally with the management service folded in beside it. */
    function lockService(options: { target?: number, timeout?: number } = {}) {
      const lock = hapService({
        type: 'LockMechanism',
        serviceName: 'Front Door',
        characteristics: [
          characteristic('LockCurrentState', 1),
          characteristic('LockTargetState', options.target ?? 1),
        ],
      })

      if (options.timeout !== undefined) {
        const management = hapService({
          type: 'LockManagement',
          serviceName: 'Front Door',
          uniqueId: 'hap-lock-mgmt',
          characteristics: [
            characteristic('LockManagementAutoSecurityTimeout', options.timeout, { minValue: 0, maxValue: 3600, minStep: 10 }),
          ],
        })
        lock.linkedServices = { 11: management as any }
      }

      return lock
    }

    function managementOf(lock: ServiceTypeX) {
      return Object.values(lock.linkedServices!)[0] as unknown as ServiceTypeX
    }

    const locked = (container: HTMLElement) => isChecked(container, 'accessories.control.lock')

    it('writes the lock buttons to LockTargetState', () => {
      const service = lockService()
      const { container } = renderManage(LockMechanismManage, service)

      clickButton(container, 'accessories.control.unlock')

      expect(writesTo(service)).toEqual([{ type: 'LockTargetState', value: 0 }])
    })

    it('offers no auto-relock control on a lock with no management service', () => {
      const { container } = renderManage(LockMechanismManage, lockService())

      expect(container.querySelector('.noUi-target')).toBeNull()
    })

    it('picks up the management service folded in beside it', () => {
      // Which is the whole reason the accessories service links the two
      const { container } = renderManage(LockMechanismManage, lockService({ timeout: 300 }))

      const slider = sliderApi(container)!
      expect(slider.get()).toBe('300')
      expect(slider.options.range).toEqual({ min: 0, max: 3600 })
      expect(slider.options.step).toBe(10)
    })

    it('shows an auto-relock time of zero as never', () => {
      const { container } = renderManage(LockMechanismManage, lockService({ timeout: 0 }))

      expect(container.querySelector('h6')!.textContent).toBe('accessories.control.lock_auto: ∞')
    })

    it('writes the auto-relock time to the management service, not the lock', async () => {
      // The two are separate HAP services; writing it on the mechanism would
      // resolve to null and throw inside the debounce
      const service = lockService({ timeout: 300 })
      const { container } = renderManage(LockMechanismManage, service)

      slideTo(container, '', 600)
      await flushDebounce(300)

      expect(writesTo(managementOf(service))).toEqual([
        { type: 'LockManagementAutoSecurityTimeout', value: 600 },
      ])
      expect(writesTo(service)).toEqual([])
    })

    it('shows the lock re-locking itself once the auto-relock time is up', async () => {
      // The accessory re-locks on its own, so the modal has to predict it or
      // the switch stays showing unlocked
      const { container } = renderManage(LockMechanismManage, lockService({ target: 1, timeout: 10 }))

      clickButton(container, 'accessories.control.unlock')
      await flushDebounce(10000)
      expect(locked(container)).toBe(false)

      await flushDebounce(300)

      expect(locked(container)).toBe(true)
    })

    it('starts the countdown again when the lock is unlocked a second time', async () => {
      const { container } = renderManage(LockMechanismManage, lockService({ target: 1, timeout: 10 }))

      clickButton(container, 'accessories.control.unlock')
      await flushDebounce(9000)
      // Unlocking again has to restart the clock, not leave the first one running
      clickButton(container, 'accessories.control.unlock')
      await flushDebounce(2000)
      expect(locked(container)).toBe(false)

      await flushDebounce(8300)

      expect(locked(container)).toBe(true)
    })

    it('cancels the countdown when the user locks it by hand', async () => {
      const service = lockService({ target: 1, timeout: 10 })
      const { container } = renderManage(LockMechanismManage, service)
      clickButton(container, 'accessories.control.unlock')

      clickButton(container, 'accessories.control.lock')
      await flushDebounce(20000)

      expect(locked(container)).toBe(true)
      expect(writesTo(service)).toEqual([
        { type: 'LockTargetState', value: 0 },
        { type: 'LockTargetState', value: 1 },
      ])
    })

    it('does not count down when there is no auto-relock time set', async () => {
      const { container } = renderManage(LockMechanismManage, lockService({ target: 1, timeout: 0 }))

      clickButton(container, 'accessories.control.unlock')
      await flushDebounce(60000)

      expect(locked(container)).toBe(false)
    })

    it('follows a lock change made elsewhere', () => {
      const service = lockService({ target: 1, timeout: 300 })
      const view = renderManage(LockMechanismManage, service)

      managementOf(service).getCharacteristic!('LockManagementAutoSecurityTimeout').value = 600
      view.pushUpdate(lockService({ target: 0, timeout: 600 }))

      expect(isChecked(view.container, 'accessories.control.unlock')).toBe(true)
      expect(sliderApi(view.container)!.get()).toBe('600')
    })
  })
  // doorbell, microphone and speaker are three copies of the same modal
  describe.each([
    ['doorbell', DoorbellManage],
    ['microphone', MicrophoneManage],
    ['speaker', SpeakerManage],
  ])('the %s modal', (_name, type) => {
    function mediaService(muted = false, volume = 60) {
      return hapService({
        type: 'Speaker',
        characteristics: [
          characteristic('Mute', muted),
          characteristic('Volume', volume, { minValue: 0, maxValue: 100, minStep: 1 }),
          characteristic('Active', 1),
          characteristic('TargetMediaState', 0),
        ],
      })
    }

    it('reads the mute state as its switch, not the active state', () => {
      // The switch on these three is mute, so an unmuted accessory shows off
      const { container } = renderManage(type, mediaService(true))

      expect(isChecked(container, 'accessories.control.mute')).toBe(true)
    })

    it('writes the switch to Mute', () => {
      const service = mediaService(false)
      const { container } = renderManage(type, service)

      clickButton(container, 'accessories.control.mute')

      expect(writesTo(service)).toEqual([{ type: 'Mute', value: true }])
    })

    it('writes the volume slider to Volume', async () => {
      const service = mediaService()
      const { container } = renderManage(type, service)

      slideTo(container, '', 25)
      await flushDebounce()

      expect(writesTo(service)).toEqual([{ type: 'Volume', value: 25 }])
    })

    it('writes the active buttons to Active', () => {
      const service = mediaService()
      const { container } = renderManage(type, service)

      clickButton(container, 'accessories.control.off')

      expect(writesTo(service)).toEqual([{ type: 'Active', value: 0 }])
    })

    it('writes the media buttons to TargetMediaState', () => {
      // Shown in place of the power buttons on one without Active
      const service = hapService({
        type: 'Speaker',
        characteristics: [characteristic('TargetMediaState', 0), characteristic('CurrentMediaState', 0)],
      })
      const { container } = renderManage(type, service)

      clickButton(container, 'accessories.control.pause')

      expect(writesTo(service)).toEqual([{ type: 'TargetMediaState', value: 1 }])
      expect(isChecked(container, 'accessories.control.play')).toBe(true)
    })

    it('follows a mute change made elsewhere', () => {
      const view = renderManage(type, mediaService(false, 60))

      view.pushUpdate(mediaService(true, 30))

      expect(isChecked(view.container, 'accessories.control.mute')).toBe(true)
      expect(sliderApi(view.container)!.get()).toBe('30')
    })

    it('heads the mute switch as the status on one with nothing else', () => {
      const { container } = renderManage(type, hapService({ type: 'Speaker', characteristics: [characteristic('Mute', false)] }))

      expect(container.querySelector('h6')!.textContent).toBe('menu.label_status')
    })
  })
  describe('the valve modal', () => {
    function valveService(active = 0, duration = 300) {
      return hapService({
        type: 'Valve',
        characteristics: [
          characteristic('Active', active),
          characteristic('SetDuration', duration, { minValue: 0, maxValue: 3600, minStep: 60 }),
        ],
      })
    }

    it('writes the switch to Active', () => {
      const service = valveService()
      const { container } = renderManage(ValveManage, service)

      clickButton(container, 'accessories.control.on')

      expect(writesTo(service)).toEqual([{ type: 'Active', value: true }])
    })

    it('writes the run time to SetDuration', async () => {
      const service = valveService()
      const { container } = renderManage(ValveManage, service)

      slideTo(container, '', 600)
      await flushDebounce()

      expect(writesTo(service)).toEqual([{ type: 'SetDuration', value: 600 }])
    })

    it('reads the run time range off the characteristic', () => {
      // (The slider itself steps by 15 seconds, whatever the characteristic says)
      const { container } = renderManage(ValveManage, valveService(0, 300))

      expect(sliderApi(container)!.get()).toBe('300')
      expect(sliderApi(container)!.options.range).toEqual({ min: 0, max: 3600 })
      expect(container.querySelector('h6')!.textContent).toBe(`accessories.control.set_duration: ${duration(300)}`)
    })

    it('shows a run time of zero as unlimited', () => {
      expect(renderManage(ValveManage, valveService(0, 0)).container.querySelector('h6')!.textContent).toBe('accessories.control.set_duration: ∞')
    })

    it('offers no run time control to a valve without one', () => {
      const { container } = renderManage(ValveManage, hapService({
        type: 'Valve',
        characteristics: [characteristic('Active', 0)],
      }))

      expect(container.querySelector('.noUi-target')).toBeNull()
    })

    it('survives a live update on a valve with no run time', () => {
      const service = hapService({ type: 'Valve', characteristics: [characteristic('Active', 0)] })
      const view = renderManage(ValveManage, service)

      expect(() => view.pushUpdate(service)).not.toThrow()
      expect(view.container.querySelector('.noUi-target')).toBeNull()
    })
  })
})
