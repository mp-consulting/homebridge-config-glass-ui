import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'
import type { FakeToast, MatterServiceFixture } from '@/testing'
import type { ComponentType } from 'react'

import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ColorTemperatureLightManage } from '@/core/accessories/types/matter/color-temperature-light/ColorTemperatureLightManage'
import { DimmableLightManage } from '@/core/accessories/types/matter/dimmable-light/DimmableLightManage'
import { ExtendedColorLightManage } from '@/core/accessories/types/matter/extended-color-light/ExtendedColorLightManage'
import { advance, changedElsewhere, isSelected, moveSlider, renderManage, settle, slider, sliderValue } from '@/core/accessories/types/matter/matter.testing'
import { toast } from '@/core/ui/toast'
import { matterService } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

/**
 * The three dimmable matter light modals.
 *
 * What these specs are really guarding is **which cluster each control writes
 * to**. Getting that wrong does not throw and does not show an error - the
 * write is simply dropped or lands on the wrong attribute, and the light
 * appears to ignore the slider. The two rules worth stating plainly:
 *
 * - Turning off goes to `onOff`, never to `levelControl`. A level of 0 is
 *   clamped up to `minLevel` (usually 1) by most devices, so the light would
 *   stay dimly on.
 * - Turning on goes to `levelControl`, so the light comes back at a level the
 *   user can see rather than at whatever it was left at.
 *
 * The debounce is 300ms in all three, so every slider assertion has to advance
 * the clock past it.
 */
describe('matter light manage modals', () => {
  const toastr = toast as unknown as FakeToast
  let service: MatterServiceFixture
  let container: HTMLElement

  const BRIGHTNESS = '.noUi-target'
  const COLOR_TEMP = '.color-temp-slider .noUi-target'
  const HUE = '.hue-slider .noUi-target'
  const SATURATION = '.saturation-slider .noUi-target'

  interface CreateOptions {
    clusters?: Record<string, Record<string, unknown>>
  }

  function create(type: ComponentType<AccessoryManageModalProps>, options: CreateOptions = {}) {
    service = matterService({
      deviceType: 'ExtendedColorLight',
      clusters: options.clusters ?? {
        onOff: { onOff: true },
        levelControl: { currentLevel: 120 },
        colorControl: { colorTemperatureMireds: 250, currentHue: 50, currentSaturation: 200 },
      },
    })
    container = renderManage(type, service).container
  }

  /** Move a slider through its 300ms debounce and let the write settle. */
  async function slide(value: number, selector = BRIGHTNESS) {
    moveSlider(container, value, selector)
    await advance(300)
  }

  function modeIsOn() {
    return isSelected(screen.getByRole('button', { name: 'accessories.control.on' }))
  }

  function heading(key: string) {
    return Array.from(container.querySelectorAll('h6')).find(h6 => h6.textContent!.startsWith(key))?.textContent
  }

  async function clickMode(on: boolean) {
    fireEvent.click(screen.getByRole('button', { name: on ? 'accessories.control.on' : 'accessories.control.off' }))
    await settle()
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
    toastr.error.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Every rule in this block was duplicated verbatim in all three Angular
  // components, so it is asserted against all three
  describe.each([
    ['dimmable light', DimmableLightManage],
    ['colour temperature light', ColorTemperatureLightManage],
    ['extended colour light', ExtendedColorLightManage],
  ])('%s brightness and power', (_name, type) => {
    it('reads the current level and on state from the clusters', () => {
      create(type)

      expect(modeIsOn()).toBe(true)
      expect(sliderValue(container, BRIGHTNESS)).toBe(120)
      expect(slider(container, BRIGHTNESS).options.range).toEqual({ min: 0, max: 254 })
    })

    it('shows the level as a percentage of 254, not of 100', () => {
      create(type, {
        clusters: { onOff: { onOff: true }, levelControl: { currentLevel: 127 }, colorControl: {} },
      })

      expect(heading('accessories.control.brightness')).toBe('accessories.control.brightness: 50%')
    })

    it('writes a brightness change to levelControl', async () => {
      create(type)

      await slide(200)

      expect(service.writes).toEqual([{ cluster: 'levelControl', attributes: { currentLevel: 200 } }])
    })

    it('waits out the debounce before writing anything', async () => {
      create(type)

      moveSlider(container, 200)
      await advance(299)

      expect(service.writes).toEqual([])
    })

    it('sends only the last value when the slider is dragged', async () => {
      create(type)

      for (const value of [130, 150, 180, 200]) {
        moveSlider(container, value)
      }
      await advance(300)

      expect(service.writes).toEqual([{ cluster: 'levelControl', attributes: { currentLevel: 200 } }])
    })

    it('writes onOff as well when the slider is moved while the light is off', async () => {
      // A raw level write does not run Matter's on/off coupling, so a slider
      // move from the off state must also set onOff
      create(type, {
        clusters: { onOff: { onOff: false }, levelControl: { currentLevel: 0 }, colorControl: {} },
      })

      await slide(200)

      expect(service.writes).toEqual([
        { cluster: 'levelControl', attributes: { currentLevel: 200 } },
        { cluster: 'onOff', attributes: { onOff: true } },
      ])
    })

    it('turns the light off through onOff when the slider reaches zero', async () => {
      // A currentLevel of 0 is clamped up to minLevel by most devices, so the
      // light would stay dimly on
      create(type)

      await slide(0)

      expect(service.writes).toEqual([{ cluster: 'onOff', attributes: { onOff: false } }])
      expect(modeIsOn()).toBe(false)
    })

    it('turns the light on through levelControl and onOff', async () => {
      // A raw level write does not run Matter's on/off coupling, so onOff
      // must be written too or the light state never reads as on
      create(type)

      await clickMode(true)

      expect(service.writes).toEqual([
        { cluster: 'levelControl', attributes: { currentLevel: 120 } },
        { cluster: 'onOff', attributes: { onOff: true } },
      ])
      expect(modeIsOn()).toBe(true)
    })

    it('turns a light that was left at zero back on at full brightness', async () => {
      create(type, {
        clusters: { onOff: { onOff: false }, levelControl: { currentLevel: 0 }, colorControl: {} },
      })

      await clickMode(true)

      expect(service.writes).toEqual([
        { cluster: 'levelControl', attributes: { currentLevel: 254 } },
        { cluster: 'onOff', attributes: { onOff: true } },
      ])
    })

    it('turns the light off through onOff', async () => {
      create(type)

      await clickMode(false)

      expect(service.writes).toEqual([{ cluster: 'onOff', attributes: { onOff: false } }])
      expect(modeIsOn()).toBe(false)
    })

    it('puts the switch back and warns when the write is refused', async () => {
      create(type)
      service.failWrites('onOff', new Error('device offline'))

      await clickMode(false)

      expect(modeIsOn()).toBe(true)
      expect(toastr.error).toHaveBeenCalledWith('toast.api_error_generic', 'toast.title_error')
    })

    it('puts the slider back when a brightness write is refused', async () => {
      create(type)
      service.failWrites('levelControl', new Error('device offline'))

      await slide(200)

      expect(sliderValue(container, BRIGHTNESS)).toBe(120)
      expect(toastr.error).toHaveBeenCalled()
    })

    it('complains rather than writing nowhere when the level cluster is missing', async () => {
      create(type, { clusters: { onOff: { onOff: true }, colorControl: {} } })

      await slide(200)

      expect(service.writes).toEqual([])
      expect(toastr.error).toHaveBeenCalled()
    })

    it('follows the accessory when it is changed elsewhere', () => {
      create(type)

      changedElsewhere(matterService({
        deviceType: 'ExtendedColorLight',
        clusters: {
          onOff: { onOff: false },
          levelControl: { currentLevel: 0 },
          colorControl: { colorTemperatureMireds: 250, currentHue: 50, currentSaturation: 200 },
        },
      }))

      expect(modeIsOn()).toBe(false)
      expect(sliderValue(container, BRIGHTNESS)).toBe(0)
    })
  })

  // Colour temperature lives on the colorControl cluster in mireds, but the
  // slider is in kelvin, so the two are inverted with respect to each other
  describe.each([
    ['colour temperature light', ColorTemperatureLightManage],
    ['extended colour light', ExtendedColorLightManage],
  ])('%s colour temperature', (_name, type) => {
    it('runs the slider from warm to cool, with the mired range inverted', () => {
      create(type)

      // 500 mireds is the warm end, 147 the cool end
      expect(slider(container, COLOR_TEMP).options.range).toEqual({ min: 2000, max: 6803 })
      expect(heading('accessories.control.color_temperature')).toBe('accessories.control.color_temperature: 250M (4000K)')
      expect(sliderValue(container, COLOR_TEMP)).toBe(4000)
    })

    it('writes mireds to colorControl, not the kelvin the slider shows', async () => {
      create(type)

      await slide(2500, COLOR_TEMP)

      expect(service.writes).toEqual([{ cluster: 'colorControl', attributes: { colorTemperatureMireds: 400 } }])
    })

    it('records the mired value straight away so the label does not lag the slider', () => {
      create(type)

      moveSlider(container, 2500, COLOR_TEMP)

      expect(heading('accessories.control.color_temperature')).toBe('accessories.control.color_temperature: 400M (2500K)')
    })

    it('puts the slider back in kelvin when the write is refused', async () => {
      create(type)
      service.failWrites('colorControl', new Error('device offline'))

      await slide(2500, COLOR_TEMP)

      expect(heading('accessories.control.color_temperature')).toBe('accessories.control.color_temperature: 250M (4000K)')
      expect(sliderValue(container, COLOR_TEMP)).toBe(4000)
    })

    it('follows a colour temperature change made elsewhere', () => {
      create(type)

      changedElsewhere(matterService({
        deviceType: 'ExtendedColorLight',
        clusters: {
          onOff: { onOff: true },
          levelControl: { currentLevel: 120 },
          colorControl: { colorTemperatureMireds: 500, currentHue: 50, currentSaturation: 200 },
        },
      }))

      expect(heading('accessories.control.color_temperature')).toBe('accessories.control.color_temperature: 500M (2000K)')
      expect(sliderValue(container, COLOR_TEMP)).toBe(2000)
    })
  })

  describe('extended colour light hue and saturation', () => {
    it('runs both sliders over the matter range, not zero to one hundred', () => {
      create(ExtendedColorLightManage)

      expect(sliderValue(container, HUE)).toBe(50)
      expect(slider(container, HUE).options.range).toEqual({ min: 0, max: 254 })
      expect(slider(container, HUE).options.step).toBe(1)
      expect(sliderValue(container, SATURATION)).toBe(200)
      expect(slider(container, SATURATION).options.range).toEqual({ min: 0, max: 254 })
      expect(slider(container, SATURATION).options.step).toBe(1)
    })

    it('reports both as a percentage of 254', () => {
      create(ExtendedColorLightManage, {
        clusters: { onOff: { onOff: true }, levelControl: { currentLevel: 120 }, colorControl: { currentHue: 127, currentSaturation: 254 } },
      })

      expect(heading('accessories.control.hue')).toBe('accessories.control.hue: 50%')
      expect(heading('accessories.control.saturation')).toBe('accessories.control.saturation: 100%')
    })

    it('sends hue and saturation together, because the cluster needs both', async () => {
      create(ExtendedColorLightManage)

      await slide(100, HUE)

      expect(service.writes).toEqual([{
        cluster: 'colorControl',
        attributes: { currentHue: 100, currentSaturation: 200 },
      }])
    })

    it('sends both from the saturation slider too', async () => {
      create(ExtendedColorLightManage)

      await slide(254, SATURATION)

      expect(service.writes).toEqual([{
        cluster: 'colorControl',
        attributes: { currentHue: 50, currentSaturation: 254 },
      }])
    })

    it('puts both sliders back when the write is refused', async () => {
      create(ExtendedColorLightManage)
      service.failWrites('colorControl', new Error('device offline'))

      moveSlider(container, 254, SATURATION)
      await slide(100, HUE)

      expect(sliderValue(container, HUE)).toBe(50)
      expect(sliderValue(container, SATURATION)).toBe(200)
    })

    it('puts both sliders back when the saturation write is refused', async () => {
      // ⚠️ The saturation slider has its own copy of the revert. Both sliders send
      // the same pair, so a revert that only put one back would leave the screen
      // claiming a colour the light never received
      create(ExtendedColorLightManage)
      service.failWrites('colorControl', new Error('device offline'))

      moveSlider(container, 100, HUE)
      await slide(254, SATURATION)

      expect(sliderValue(container, HUE)).toBe(50)
      expect(sliderValue(container, SATURATION)).toBe(200)
      expect(toastr.error).toHaveBeenCalled()
    })

    it('complains rather than writing nowhere when the colour cluster is missing', async () => {
      // No colour cluster at all also hides the sliders, so this goes through
      // a feature map that claims the feature anyway
      create(ExtendedColorLightManage, {
        clusters: { onOff: { onOff: true }, levelControl: { currentLevel: 120 }, colorControl: { featureMap: { hueSaturation: true } } },
      })
      vi.mocked(service.getCluster!).mockImplementation(name => name === 'colorControl'
        ? null
        : { attributes: {}, setAttributes: vi.fn(async () => undefined) })

      await slide(254, SATURATION)

      expect(toastr.error).toHaveBeenCalled()
    })

    function changedColour(colorControl: Record<string, unknown>) {
      changedElsewhere(matterService({
        deviceType: 'ExtendedColorLight',
        clusters: {
          onOff: { onOff: true },
          levelControl: { currentLevel: 120 },
          colorControl,
        },
      }))
    }

    it('follows a colour change made elsewhere', () => {
      create(ExtendedColorLightManage)

      changedColour({ colorTemperatureMireds: 250, currentHue: 200, currentSaturation: 100 })

      expect(sliderValue(container, HUE)).toBe(200)
      expect(sliderValue(container, SATURATION)).toBe(100)
    })

    it('takes a saturation change without touching the hue', () => {
      // The hue slider's gradient is rebuilt only when the hue itself moves, so
      // the sliders do not redraw on every unrelated poll
      create(ExtendedColorLightManage)

      changedColour({ colorTemperatureMireds: 250, currentHue: 50, currentSaturation: 10 })

      expect(sliderValue(container, HUE)).toBe(50)
      expect(sliderValue(container, SATURATION)).toBe(10)
    })
  })

  describe('extended colour light feature gating', () => {
    it('offers colour temperature when the feature map says the device has it', () => {
      create(ExtendedColorLightManage, {
        clusters: {
          onOff: { onOff: true },
          levelControl: { currentLevel: 120 },
          colorControl: { featureMap: { colorTemperature: true, hueSaturation: true } },
        },
      })

      expect(container.querySelector('.color-temp-slider')).not.toBeNull()
      expect(container.querySelector('.hue-slider')).not.toBeNull()
    })

    it('hides colour temperature when the feature map says it is absent', () => {
      // The declared attribute is present, so only the feature map can rule
      // it out - writing to a cluster without the feature is rejected
      create(ExtendedColorLightManage, {
        clusters: {
          onOff: { onOff: true },
          levelControl: { currentLevel: 120 },
          colorControl: { colorTemperatureMireds: 250, currentHue: 50, featureMap: { colorTemperature: false, hueSaturation: true } },
        },
      })

      expect(container.querySelector('.color-temp-slider')).toBeNull()
      expect(container.querySelector('.hue-slider')).not.toBeNull()
    })

    it('falls back to the declared attributes when no feature map is sent', () => {
      // Older Homebridge versions send no feature map at all
      create(ExtendedColorLightManage, {
        clusters: {
          onOff: { onOff: true },
          levelControl: { currentLevel: 120 },
          colorControl: { currentHue: 50, currentSaturation: 200 },
        },
      })

      expect(container.querySelector('.color-temp-slider')).toBeNull()
      expect(container.querySelector('.hue-slider')).not.toBeNull()
    })

    it('skips loading the colour temperature slider when the device has none', () => {
      create(ExtendedColorLightManage, {
        clusters: {
          onOff: { onOff: true },
          levelControl: { currentLevel: 120 },
          colorControl: { currentHue: 50, currentSaturation: 200 },
        },
      })

      expect(heading('accessories.control.color_temperature')).toBeUndefined()
    })

    it('survives a live update on a device with no colour temperature', () => {
      create(ExtendedColorLightManage, {
        clusters: {
          onOff: { onOff: true },
          levelControl: { currentLevel: 120 },
          colorControl: { currentHue: 50, currentSaturation: 200 },
        },
      })

      expect(() => changedElsewhere(service)).not.toThrow()
      expect(sliderValue(container, BRIGHTNESS)).toBe(120)
      expect(container.querySelector('.color-temp-slider')).toBeNull()
    })
  })
})
