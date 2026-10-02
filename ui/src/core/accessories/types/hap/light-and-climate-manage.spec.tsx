import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

import { act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AirPurifierManage } from '@/core/accessories/types/hap/air-purifier/AirPurifierManage'
import { clickButton, flushDebounce, isChecked, renderManage, sliderApi, slideTo, writesTo } from '@/core/accessories/types/hap/hap.spec-helpers'
import { HeaterCoolerManage } from '@/core/accessories/types/hap/heater-cooler/HeaterCoolerManage'
import { HumidifierDehumidifierManage } from '@/core/accessories/types/hap/humidifier-dehumidifier/HumidifierDehumidifierManage'
import { createAdaptiveLightingSignal } from '@/core/accessories/types/hap/lightbulb/adaptive-lighting'
import { LightbulbManage } from '@/core/accessories/types/hap/lightbulb/LightbulbManage'
import { ThermostatManage } from '@/core/accessories/types/hap/thermostat/ThermostatManage'
import { useSettingsStore } from '@/core/settings/settings.store'
import { characteristic, hapService, makeSettingsState } from '@/testing'

/**
 * The most involved HAP manage modals.
 *
 * HAP control is characteristic-based rather than cluster-based, so the risk is
 * the mirror image of the matter modals: writing the right value to the wrong
 * characteristic name. A wrong name resolves to `null` from
 * `getCharacteristic`, which throws inside a debounce callback where nothing
 * catches it - the slider simply stops working.
 *
 * The debounce is the hook's default of 500ms.
 */
describe('hAP light and climate manage modals', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(console.error).mockRestore()
  })

  describe('lightbulb', () => {
    /** A full-colour bulb: on/off, brightness, hue, saturation, colour temperature. */
    function colourBulb(values: { on?: boolean, brightness?: number, hue?: number, saturation?: number, mired?: number } = {}) {
      return hapService({
        type: 'Lightbulb',
        serviceName: 'Test Bulb',
        characteristics: [
          characteristic('On', values.on ?? true),
          characteristic('Brightness', values.brightness ?? 60, { minValue: 0, maxValue: 100, minStep: 1 }),
          characteristic('Hue', values.hue ?? 120, { minValue: 0, maxValue: 360, minStep: 1 }),
          characteristic('Saturation', values.saturation ?? 80, { minValue: 0, maxValue: 100, minStep: 1 }),
          characteristic('ColorTemperature', values.mired ?? 250, { minValue: 140, maxValue: 500, minStep: 1 }),
        ],
      })
    }

    /** A plain white bulb with nothing but on/off. */
    function plainBulb() {
      return hapService({
        type: 'Lightbulb',
        serviceName: 'Plain Bulb',
        characteristics: [characteristic('On', false)],
      })
    }

    it('reads the sliders from the characteristics rather than assuming a range', () => {
      // Plugins declare their own ranges; a bulb reporting 0-254 brightness
      // must not be driven as though it were 0-100
      const bulb = hapService({
        type: 'Lightbulb',
        characteristics: [
          characteristic('On', true),
          characteristic('Brightness', 200, { minValue: 0, maxValue: 254, minStep: 2 }),
        ],
      })
      const { container } = renderManage(LightbulbManage, bulb)

      const slider = sliderApi(container, '.brightness-slider')!
      expect(slider.get()).toBe('200')
      expect(slider.options.range).toEqual({ min: 0, max: 254 })
      expect(slider.options.step).toBe(2)
    })

    it('leaves the optional sliders out on a bulb that has none', () => {
      const { container } = renderManage(LightbulbManage, plainBulb())

      expect(container.querySelector('.noUi-target')).toBeNull()
      expect(isChecked(container, 'accessories.control.off')).toBe(true)
    })

    it('writes a brightness change to Brightness', async () => {
      const bulb = colourBulb()
      const { container } = renderManage(LightbulbManage, bulb)

      slideTo(container, '.brightness-slider', 30)
      await flushDebounce()

      expect(writesTo(bulb)).toEqual([{ type: 'Brightness', value: 30 }])
    })

    it('turns the bulb on when the slider is raised off zero', async () => {
      // Otherwise dragging the brightness up on an off bulb changes nothing
      const bulb = colourBulb({ on: false, brightness: 0 })
      const { container } = renderManage(LightbulbManage, bulb)

      slideTo(container, '.brightness-slider', 40)
      await flushDebounce()

      expect(writesTo(bulb)).toEqual([
        { type: 'Brightness', value: 40 },
        { type: 'On', value: true },
      ])
      expect(isChecked(container, 'accessories.control.on')).toBe(true)
    })

    it('turns the bulb off when the slider is dragged to zero', async () => {
      const bulb = colourBulb({ on: true, brightness: 60 })
      const { container } = renderManage(LightbulbManage, bulb)

      slideTo(container, '.brightness-slider', 0)
      await flushDebounce()

      expect(writesTo(bulb)).toEqual([
        { type: 'Brightness', value: 0 },
        { type: 'On', value: false },
      ])
      expect(isChecked(container, 'accessories.control.off')).toBe(true)
    })

    it('does not touch On when the bulb is already in the right state', async () => {
      const bulb = colourBulb({ on: true, brightness: 60 })
      const { container } = renderManage(LightbulbManage, bulb)

      slideTo(container, '.brightness-slider', 90)
      await flushDebounce()

      expect(writesTo(bulb).filter(write => write.type === 'On')).toEqual([])
    })

    it('writes only the last of a run of slider moves', async () => {
      const bulb = colourBulb()
      const { container } = renderManage(LightbulbManage, bulb)

      slideTo(container, '.brightness-slider', 70)
      slideTo(container, '.brightness-slider', 80)
      await flushDebounce()

      expect(writesTo(bulb)).toEqual([{ type: 'Brightness', value: 80 }])
    })

    it('writes hue and saturation to their own characteristics, separately', async () => {
      // HAP takes them one at a time, unlike the matter colorControl cluster
      const bulb = colourBulb()
      const { container } = renderManage(LightbulbManage, bulb)

      slideTo(container, '.hue-slider', 200)
      slideTo(container, '.saturation-slider', 50)
      await flushDebounce()

      expect(writesTo(bulb)).toEqual([
        { type: 'Hue', value: 200 },
        { type: 'Saturation', value: 50 },
      ])
    })

    it('writes mireds to ColorTemperature, not the kelvin the slider shows', async () => {
      const bulb = colourBulb()
      const { container } = renderManage(LightbulbManage, bulb)

      slideTo(container, '.color-temp-slider', 2500)
      await flushDebounce()

      expect(writesTo(bulb)).toEqual([{ type: 'ColorTemperature', value: 400 }])
      expect(container.textContent).toContain('400M (2500K)')
    })

    it('inverts the colour temperature range, because mired and kelvin run opposite ways', () => {
      const { container } = renderManage(LightbulbManage, colourBulb())

      // The characteristic's 140-500 mired range, read as kelvin
      const slider = sliderApi(container, '.color-temp-slider')!
      expect(slider.options.range).toEqual({ min: 2000, max: 7143 })
      expect(slider.get()).toBe('4000')
      expect(container.textContent).toContain('250M (4000K)')
    })

    it('writes On when the switch is pressed', () => {
      const bulb = colourBulb({ on: false })
      const { container } = renderManage(LightbulbManage, bulb)

      clickButton(container, 'accessories.control.on')

      expect(writesTo(bulb)).toEqual([{ type: 'On', value: true }])
    })

    it('moves the slider to full when switching on a bulb sitting at zero', () => {
      // Only the local slider moves - the brightness itself is left to the
      // accessory, which restores whatever level it remembers
      const bulb = colourBulb({ on: false, brightness: 0 })
      const { container } = renderManage(LightbulbManage, bulb)

      clickButton(container, 'accessories.control.on')

      expect(sliderApi(container, '.brightness-slider')!.get()).toBe('100')
      expect(writesTo(bulb)).toEqual([{ type: 'On', value: true }])
    })

    it('follows a change made elsewhere', () => {
      const bulb = colourBulb()
      const view = renderManage(LightbulbManage, bulb)

      view.pushUpdate(colourBulb({ on: false, brightness: 10, hue: 300, saturation: 20, mired: 500 }))

      expect(isChecked(view.container, 'accessories.control.off')).toBe(true)
      expect(sliderApi(view.container, '.brightness-slider')!.get()).toBe('10')
      expect(sliderApi(view.container, '.hue-slider')!.get()).toBe('300')
      expect(sliderApi(view.container, '.saturation-slider')!.get()).toBe('20')
      expect(sliderApi(view.container, '.color-temp-slider')!.get()).toBe('2000')
      expect(view.container.textContent).toContain('500M (2000K)')
    })

    it('does not write back a change made elsewhere', async () => {
      const bulb = colourBulb()
      const view = renderManage(LightbulbManage, bulb)

      view.pushUpdate(colourBulb({ brightness: 10 }))
      await flushDebounce()

      expect(writesTo(bulb)).toEqual([])
    })

    it('reports no adaptive lighting when the opener did not provide it', () => {
      // A bulb opened outside the accessories page must not claim the feature
      const { container } = renderManage(LightbulbManage, colourBulb())

      expect(container.textContent).not.toContain('accessories.control.adaptive_lighting')
    })

    it('shows the adaptive lighting state live, and the note under the colour sliders', () => {
      const signal = createAdaptiveLightingSignal(false)
      const { container } = renderManage(LightbulbManage, colourBulb(), { adaptiveLighting: signal })

      expect(container.textContent).toContain('accessories.control.adaptive_lighting: OFF')
      expect(container.textContent).not.toContain('accessories.control.adaptive_lighting_note')

      act(() => signal.set(true))

      expect(container.textContent).toContain('accessories.control.adaptive_lighting: ON')
      expect(container.querySelectorAll('.small.grey-text')).toHaveLength(3)
    })

    it('paints the slider gradients', async () => {
      const { container } = renderManage(LightbulbManage, colourBulb())
      await flushDebounce(20)

      expect((container.querySelector('.brightness-slider .noUi-target') as HTMLElement).style.background).toContain('linear-gradient')
      expect((container.querySelector('.hue-slider .noUi-target') as HTMLElement).style.background).toContain('linear-gradient')
    })

    it('closes on the close button', () => {
      const view = renderManage(LightbulbManage, colourBulb())

      fireEvent.click(view.container.querySelector('.btn-close')!)

      expect(view.activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })
  })
  describe('thermostat', () => {
    /** A dual-mode thermostat with both a setpoint and the auto thresholds. */
    function thermostat(options: {
      mode?: number
      currentState?: number
      target?: number
      heating?: number
      cooling?: number
      validValues?: number[]
      humidity?: boolean
    } = {}) {
      const characteristics = [
        characteristic('CurrentHeatingCoolingState', options.currentState ?? 0),
        characteristic('TargetHeatingCoolingState', options.mode ?? 1, { validValues: options.validValues ?? [0, 1, 2, 3] }),
        characteristic('TargetTemperature', options.target ?? 21, { minValue: 10, maxValue: 38, minStep: 0.5 }),
        characteristic('HeatingThresholdTemperature', options.heating ?? 18, { minValue: 0, maxValue: 25, minStep: 0.5 }),
        characteristic('CoolingThresholdTemperature', options.cooling ?? 24, { minValue: 10, maxValue: 35, minStep: 0.5 }),
        characteristic('CurrentTemperature', 20.5),
      ]
      if (options.humidity) {
        characteristics.push(characteristic('CurrentRelativeHumidity', 45))
      }
      return hapService({ type: 'Thermostat', serviceName: 'Hallway', characteristics })
    }

    /** The two handles of the auto range slider. */
    function autoRange(container: HTMLElement) {
      return [...container.querySelectorAll('.noUi-target')].map(el => (el as any).noUiSlider).find(api => Array.isArray(api.get()))
    }

    afterEach(() => {
      useSettingsStore.setState(makeSettingsState())
    })

    it('reads the setpoint and both thresholds', () => {
      const { container } = renderManage(ThermostatManage, thermostat())

      expect(isChecked(container, 'accessories.control.heat')).toBe(true)
      const setpoint = sliderApi(container)!
      expect(setpoint.get()).toBe('21')
      expect(setpoint.options.range).toEqual({ min: 10, max: 38 })
      expect(setpoint.options.step).toBe(0.5)
      expect(autoRange(container).get()).toEqual(['18', '24'])
      expect(container.textContent).toContain('accessories.control.threshold_auto: 18°C - 24°C')
    })

    it('falls back to half a degree when the accessory declares no step', () => {
      // A step of zero would make the slider unusable
      const service = hapService({
        type: 'Thermostat',
        characteristics: [
          characteristic('TargetHeatingCoolingState', 1, { validValues: [0, 1] }),
          characteristic('TargetTemperature', 21, { minValue: 10, maxValue: 38, minStep: 0 }),
        ],
      })
      const { container } = renderManage(ThermostatManage, service)

      expect(sliderApi(container)!.options.step).toBe(0.5)
    })

    it('writes the single setpoint to TargetTemperature', async () => {
      // Not to a threshold - those are only used in auto mode
      const service = thermostat()
      const { container } = renderManage(ThermostatManage, service)

      act(() => sliderApi(container)!.set(23))
      await flushDebounce()

      expect(writesTo(service)).toEqual([{ type: 'TargetTemperature', value: 23 }])
    })

    it('writes both thresholds together in auto mode', async () => {
      const service = thermostat({ mode: 3 })
      const { container } = renderManage(ThermostatManage, service)

      act(() => autoRange(container).set([19, 26]))
      await flushDebounce()

      expect(writesTo(service)).toEqual([
        { type: 'HeatingThresholdTemperature', value: 19 },
        { type: 'CoolingThresholdTemperature', value: 26 },
      ])
    })

    it('keeps the paired range in step with a single threshold change', async () => {
      // A thermostat with only a heating threshold gets a single slider
      const service = hapService({
        type: 'Thermostat',
        characteristics: [
          characteristic('TargetHeatingCoolingState', 3, { validValues: [0, 3] }),
          characteristic('HeatingThresholdTemperature', 18, { minValue: 0, maxValue: 25, minStep: 0.5 }),
        ],
      })
      const { container } = renderManage(ThermostatManage, service)

      act(() => sliderApi(container)!.set(20))
      await flushDebounce()

      expect(container.textContent).toContain('accessories.control.threshold_auto: 20°C')
      expect(writesTo(service)).toEqual([{ type: 'HeatingThresholdTemperature', value: 20 }])
    })

    it('writes the mode to TargetHeatingCoolingState', () => {
      const service = thermostat()
      const { container } = renderManage(ThermostatManage, service)

      clickButton(container, 'accessories.control.cool')

      expect(writesTo(service)).toEqual([{ type: 'TargetHeatingCoolingState', value: 2 }])
      expect(isChecked(container, 'accessories.control.cool')).toBe(true)
    })

    it('shows the humidity reading only when the accessory reports one', () => {
      expect(renderManage(ThermostatManage, thermostat({ humidity: true })).container.querySelector('h6')!.textContent).toContain('45%')
      expect(renderManage(ThermostatManage, thermostat()).container.querySelector('h6')!.textContent).not.toContain('%')
    })

    it('offers only the modes the accessory supports', () => {
      const { container } = renderManage(ThermostatManage, thermostat({ validValues: [0, 1] }))

      expect([...container.querySelectorAll('.btn-control')].map(b => b.textContent?.trim())).toEqual([
        'accessories.control.off',
        'accessories.control.heat',
      ])
    })

    describe('the status colour', () => {
      it.each([
        ['status-color-cooling', { currentState: 2 }],
        ['status-color-heating', { currentState: 1 }],
        ['status-color-inactive', { currentState: 0, mode: 0 }],
      ])('is %s from what it is currently doing', (expected, options) => {
        const { container } = renderManage(ThermostatManage, thermostat(options))

        expect(container.querySelector('.fa-temperature-full')).toHaveClass(expected)
      })

      it('shows an idle thermostat in auto mode as active rather than off', () => {
        // It is waiting rather than switched off, and the two look different
        const { container } = renderManage(ThermostatManage, thermostat({ currentState: 0, mode: 3 }))

        expect(container.querySelector('.fa-temperature-full')).toHaveClass('status-color-active')
      })
    })

    it('takes the temperature unit from the user settings', () => {
      useSettingsStore.setState(makeSettingsState({ env: { temperatureUnits: 'f' } }))
      const { container } = renderManage(ThermostatManage, thermostat())

      expect(container.querySelector('h6')!.textContent).toContain('68.9°F')
    })

    it('follows a change made elsewhere', () => {
      const view = renderManage(ThermostatManage, thermostat())

      view.pushUpdate(thermostat({ mode: 3, target: 25, heating: 15, cooling: 30 }))

      expect(isChecked(view.container, 'accessories.control.auto')).toBe(true)
      expect(sliderApi(view.container)!.get()).toBe('25')
      expect(autoRange(view.container).get()).toEqual(['15', '30'])
    })
  })
  describe('heater cooler', () => {
    /** A heater cooler, optionally with a fan folded in from the same accessory. */
    function heaterCooler(options: {
      active?: number
      mode?: number
      validValues?: number[]
      heating?: number
      cooling?: number
      currentState?: number
      fanSpeed?: number
    } = {}) {
      const characteristics = [
        characteristic('Active', options.active ?? 1),
        characteristic('CurrentHeaterCoolerState', options.currentState ?? 2),
        characteristic('TargetHeaterCoolerState', options.mode ?? 0, { validValues: options.validValues ?? [0, 1, 2] }),
        characteristic('HeatingThresholdTemperature', options.heating ?? 18, { minValue: 10, maxValue: 25, minStep: 0.5 }),
        characteristic('CoolingThresholdTemperature', options.cooling ?? 24, { minValue: 18, maxValue: 35, minStep: 0.5 }),
      ]

      const unit = hapService({ type: 'HeaterCooler', serviceName: 'Aircon', characteristics })

      if (options.fanSpeed !== undefined) {
        const fan = hapService({
          type: 'Fanv2',
          serviceName: 'Aircon',
          uniqueId: 'hap-fan',
          characteristics: [characteristic('RotationSpeed', options.fanSpeed, { minValue: 0, maxValue: 100, minStep: 25, unit: 'percentage' })],
        })
        unit.linkedServices = { 11: fan as any }
      }

      return unit
    }

    function modeButtons(container: HTMLElement) {
      return [...container.querySelectorAll('[aria-label="accessories.control.mode_control"] .btn-control')].map(b => b.textContent?.trim())
    }

    it('reads the two setpoints and the mode', () => {
      const { container } = renderManage(HeaterCoolerManage, heaterCooler())

      expect(isChecked(container, 'accessories.control.on')).toBe(true)
      expect(isChecked(container, 'accessories.control.auto')).toBe(true)
      expect(sliderApi(container, '.temp-slider')!.get()).toEqual(['18', '24'])
      expect(container.textContent).toContain('accessories.control.temperature_thresholds: 18°C - 24°C')
    })

    it('treats a unit that cannot cool as a heater', () => {
      const { container } = renderManage(HeaterCoolerManage, heaterCooler({ active: 1, currentState: 1, validValues: [0, 1] }))

      expect(container.querySelector('.fa-temperature-full')).toHaveClass('status-color-heating')
      expect(modeButtons(container)).toEqual(['accessories.control.auto', 'accessories.control.heat'])
    })

    it('treats a unit that cannot heat as a cooler', () => {
      const { container } = renderManage(HeaterCoolerManage, heaterCooler({ active: 1, currentState: 1, validValues: [0, 2] }))

      expect(container.querySelector('.fa-temperature-full')).toHaveClass('status-color-cooling')
    })

    it('leaves the type unset on a unit that can do both', () => {
      // All three mode buttons are offered
      const { container } = renderManage(HeaterCoolerManage, heaterCooler({ active: 1, currentState: 1, validValues: [0, 1, 2] }))

      expect(container.querySelector('.fa-temperature-full')).toHaveClass('status-color-active')
      expect(modeButtons(container)).toEqual(['accessories.control.auto', 'accessories.control.heat', 'accessories.control.cool'])
    })

    it('writes both setpoints together, because auto mode needs the pair', async () => {
      const unit = heaterCooler()
      const { container } = renderManage(HeaterCoolerManage, unit)

      act(() => sliderApi(container, '.temp-slider')!.set([20, 26] as any))
      await flushDebounce()

      expect(writesTo(unit)).toEqual([
        { type: 'HeatingThresholdTemperature', value: 20 },
        { type: 'CoolingThresholdTemperature', value: 26 },
      ])
    })

    it('keeps the paired range in step with a single setpoint change', async () => {
      // In cool mode only the cooling slider shows; the heating half goes along unchanged
      const unit = heaterCooler({ mode: 2 })
      const { container } = renderManage(HeaterCoolerManage, unit)

      slideTo(container, '.temp-slider', 30)
      await flushDebounce()

      expect(container.textContent).toContain('accessories.control.cooling_threshold: 30°C')
      expect(writesTo(unit)).toEqual([
        { type: 'HeatingThresholdTemperature', value: 18 },
        { type: 'CoolingThresholdTemperature', value: 30 },
      ])
    })

    it('shows the heating threshold alone in heat mode', () => {
      const { container } = renderManage(HeaterCoolerManage, heaterCooler({ mode: 1 }))

      expect(container.textContent).toContain('accessories.control.heating_threshold: 18°C')
    })

    it('writes Active when the unit is switched off', () => {
      const unit = heaterCooler()
      const { container } = renderManage(HeaterCoolerManage, unit)

      clickButton(container, 'accessories.control.off')

      expect(writesTo(unit)).toEqual([{ type: 'Active', value: 0 }])
      expect(isChecked(container, 'accessories.control.off')).toBe(true)
    })

    it('writes TargetHeaterCoolerState when the mode is changed', () => {
      const unit = heaterCooler()
      const { container } = renderManage(HeaterCoolerManage, unit)

      clickButton(container, 'accessories.control.cool')

      expect(writesTo(unit)).toEqual([{ type: 'TargetHeaterCoolerState', value: 2 }])
      expect(isChecked(container, 'accessories.control.cool')).toBe(true)
    })

    it('picks up the fan folded in from the same physical accessory', () => {
      const { container } = renderManage(HeaterCoolerManage, heaterCooler({ fanSpeed: 50 }))

      const fan = sliderApi(container, '.fan-slider')!
      expect(fan.get()).toBe('50')
      expect(fan.options.range).toEqual({ min: 0, max: 100 })
      expect(fan.options.step).toBe(25)
      expect(container.textContent).toContain('accessories.control.rotation_speed: 50%')
    })

    it('writes the fan speed to the fan service, not to the unit', async () => {
      // The two are separate HAP services; writing RotationSpeed on the
      // heater cooler would resolve to null and throw
      const unit = heaterCooler({ fanSpeed: 50 })
      const fan = Object.values(unit.linkedServices!)[0] as unknown as ServiceTypeX
      const { container } = renderManage(HeaterCoolerManage, unit)

      slideTo(container, '.fan-slider', 75)
      await flushDebounce()

      expect(writesTo(fan)).toEqual([{ type: 'RotationSpeed', value: 75 }])
      expect(writesTo(unit)).toEqual([])
    })

    it('offers no fan slider on a unit without one', () => {
      const { container } = renderManage(HeaterCoolerManage, heaterCooler())

      expect(container.querySelector('.fan-slider')).toBeNull()
    })

    it('ignores a linked service that is not a fan', () => {
      const unit = heaterCooler()
      unit.linkedServices = { 12: hapService({ type: 'TemperatureSensor', uniqueId: 'hap-temp' }) as any }
      const { container } = renderManage(HeaterCoolerManage, unit)

      expect(container.querySelector('.fan-slider')).toBeNull()
    })

    it.each([
      ['grey while off', { active: 0 }, 'rgb(192, 192, 192)'],
      ['blue while cooling', { mode: 2 }, 'rgb(173, 216, 230)'],
      ['orange while heating', { mode: 1 }, 'rgb(255, 185, 120)'],
      ['green in auto', { mode: 0 }, 'rgb(144, 238, 144)'],
    ])('paints the fan slider %s', async (_label, options, colour) => {
      const { container } = renderManage(HeaterCoolerManage, heaterCooler({ fanSpeed: 50, ...options }))
      await flushDebounce(20)

      expect((container.querySelector('.fan-slider .noUi-target') as HTMLElement).style.background).toContain(colour)
    })

    describe('the status colour', () => {
      it.each([
        ['status-color-cooling', { active: 1, currentState: 3 }],
        ['status-color-heating', { active: 1, currentState: 2 }],
        ['status-color-active', { active: 1, currentState: 1 }],
        ['status-color-inactive', { active: 0, currentState: 0 }],
      ])('is %s', (expected, options) => {
        const { container } = renderManage(HeaterCoolerManage, heaterCooler(options))

        expect(container.querySelector('.fa-temperature-full')).toHaveClass(expected)
      })

      it('shows a cool-only unit as cooling whenever it is running', () => {
        // Such a unit never reports CurrentHeaterCoolerState 3
        const { container } = renderManage(HeaterCoolerManage, heaterCooler({ active: 1, currentState: 1, validValues: [0, 2] }))

        expect(container.querySelector('.fa-temperature-full')).toHaveClass('status-color-cooling')
      })

      it('shows a heat-only unit as heating whenever it is running', () => {
        const { container } = renderManage(HeaterCoolerManage, heaterCooler({ active: 1, currentState: 1, validValues: [0, 1] }))

        expect(container.querySelector('.fa-temperature-full')).toHaveClass('status-color-heating')
      })
    })

    it('takes the temperature unit from the user settings', () => {
      useSettingsStore.setState(makeSettingsState({ env: { temperatureUnits: 'f' } }))
      const { container } = renderManage(HeaterCoolerManage, heaterCooler())

      expect(container.textContent).toContain('64.4°F - 75.2°F')
      useSettingsStore.setState(makeSettingsState())
    })

    it('follows a change made elsewhere, fan speed included', () => {
      const unit = heaterCooler({ fanSpeed: 50 })
      const view = renderManage(HeaterCoolerManage, unit)

      const fan = Object.values(unit.linkedServices!)[0] as unknown as ServiceTypeX
      fan.getCharacteristic!('RotationSpeed').value = 100
      view.pushUpdate(heaterCooler({ active: 0, mode: 2, heating: 15, cooling: 30, fanSpeed: 100 }))

      expect(isChecked(view.container, 'accessories.control.off')).toBe(true)
      expect(isChecked(view.container, 'accessories.control.cool')).toBe(true)
      expect(view.container.textContent).toContain('accessories.control.cooling_threshold: 30°C')
      expect(sliderApi(view.container, '.fan-slider')!.get()).toBe('100')
    })
  })
  describe('humidifier dehumidifier', () => {
    function unit(options: {
      active?: number
      mode?: number
      validValues?: number[]
      humidify?: number
      dehumidify?: number
      fanSpeed?: number
      currentState?: number
    } = {}) {
      const characteristics = [
        characteristic('Active', options.active ?? 1),
        characteristic('CurrentHumidifierDehumidifierState', options.currentState ?? 1),
        characteristic('TargetHumidifierDehumidifierState', options.mode ?? 0, { validValues: options.validValues ?? [0, 1, 2] }),
        characteristic('RelativeHumidityHumidifierThreshold', options.humidify ?? 45, { minValue: 0, maxValue: 100, minStep: 1 }),
        characteristic('RelativeHumidityDehumidifierThreshold', options.dehumidify ?? 60, { minValue: 0, maxValue: 100, minStep: 1 }),
      ]

      const device = hapService({ type: 'HumidifierDehumidifier', serviceName: 'Bedroom', characteristics })

      if (options.fanSpeed !== undefined) {
        const fan = hapService({
          type: 'Fanv2',
          serviceName: 'Bedroom',
          uniqueId: 'hap-fan',
          characteristics: [characteristic('RotationSpeed', options.fanSpeed, { minValue: 0, maxValue: 100, minStep: 25 })],
        })
        device.linkedServices = { 11: fan as any }
      }

      return device
    }

    function statusIcon(container: HTMLElement) {
      return container.querySelector('.fa-temperature-full')
    }

    it('reads both thresholds and the mode', () => {
      const { container } = renderManage(HumidifierDehumidifierManage, unit())

      expect(isChecked(container, 'accessories.control.on')).toBe(true)
      expect(isChecked(container, 'accessories.control.auto')).toBe(true)
      expect(sliderApi(container, '.humidity-slider')!.get()).toEqual(['45', '60'])
      expect(container.textContent).toContain('accessories.control.humidity_thresholds: 45% - 60%')
    })

    it('treats a unit that cannot dehumidify as a humidifier', () => {
      const { container } = renderManage(HumidifierDehumidifierManage, unit({ validValues: [0, 1] }))

      // A dedicated humidifier counts as humidifying whenever it is on
      expect(statusIcon(container)).toHaveClass('status-color-cooling')
    })

    it('treats a unit that cannot humidify as a dehumidifier', () => {
      const { container } = renderManage(HumidifierDehumidifierManage, unit({ validValues: [0, 2] }))

      expect(statusIcon(container)).toHaveClass('status-color-heating')
    })

    it('leaves the type unset on a unit that can do both', () => {
      const { container } = renderManage(HumidifierDehumidifierManage, unit({ validValues: [0, 1, 2] }))

      expect(statusIcon(container)).toHaveClass('status-color-active')
    })

    it('writes the switch to Active', () => {
      const service = unit()
      const { container } = renderManage(HumidifierDehumidifierManage, service)

      clickButton(container, 'accessories.control.off')

      expect(writesTo(service)).toEqual([{ type: 'Active', value: 0 }])
    })

    it('writes the mode to TargetHumidifierDehumidifierState', () => {
      const service = unit()
      const { container } = renderManage(HumidifierDehumidifierManage, service)

      clickButton(container, 'accessories.control.dehumidify')

      expect(writesTo(service)).toEqual([{ type: 'TargetHumidifierDehumidifierState', value: 2 }])
      expect(container.textContent).toContain('accessories.control.dehumidifier_threshold: 60%')
    })

    it('writes each threshold to its own characteristic', async () => {
      // The two names differ by one word, and swapping them makes a humidifier
      // chase the dehumidify target
      const service = unit()
      const { container } = renderManage(HumidifierDehumidifierManage, service)

      act(() => sliderApi(container, '.humidity-slider')!.set([40, 70] as any))
      await flushDebounce()

      expect(writesTo(service)).toEqual([
        { type: 'RelativeHumidityHumidifierThreshold', value: 40 },
        { type: 'RelativeHumidityDehumidifierThreshold', value: 70 },
      ])
    })

    it('writes the fan speed to the fan folded in beside it', async () => {
      const service = unit({ fanSpeed: 50 })
      const fan = Object.values(service.linkedServices!)[0] as unknown as ServiceTypeX
      const { container } = renderManage(HumidifierDehumidifierManage, service)

      slideTo(container, '.fan-slider', 75)
      await flushDebounce()

      expect(writesTo(fan)).toEqual([{ type: 'RotationSpeed', value: 75 }])
      expect(writesTo(service)).toEqual([])
    })

    it('offers no fan slider on a unit without one', () => {
      const { container } = renderManage(HumidifierDehumidifierManage, unit())

      expect(container.querySelector('.fan-slider')).toBeNull()
    })

    it('follows a change made elsewhere, fan speed included', () => {
      const service = unit({ fanSpeed: 50 })
      const view = renderManage(HumidifierDehumidifierManage, service)

      const fan = Object.values(service.linkedServices!)[0] as unknown as ServiceTypeX
      fan.getCharacteristic!('RotationSpeed').value = 100
      view.pushUpdate(unit({ active: 0, mode: 2, humidify: 30, dehumidify: 80, fanSpeed: 100 }))

      expect(isChecked(view.container, 'accessories.control.off')).toBe(true)
      expect(isChecked(view.container, 'accessories.control.dehumidify')).toBe(true)
      expect(view.container.textContent).toContain('accessories.control.dehumidifier_threshold: 80%')
      expect(sliderApi(view.container, '.fan-slider')!.get()).toBe('100')
    })

    it('follows a change on a unit that has no fan', () => {
      // ⚠️ The fan is optional, so the update has to cope with there being none
      const view = renderManage(HumidifierDehumidifierManage, unit())

      expect(() => view.pushUpdate(unit({ active: 0, mode: 1 }))).not.toThrow()
      expect(isChecked(view.container, 'accessories.control.humidify')).toBe(true)
    })

    it('writes both thresholds when one of the pair is moved', async () => {
      // ⚠️ They are one control with two handles. Writing only the moved handle
      // leaves the other showing a value the accessory never received
      const service = unit({ mode: 1 })
      const { container } = renderManage(HumidifierDehumidifierManage, service)

      slideTo(container, '.humidity-slider', 35)
      await flushDebounce()

      expect(container.textContent).toContain('accessories.control.humidifier_threshold: 35%')
      expect(writesTo(service)).toEqual([
        { type: 'RelativeHumidityHumidifierThreshold', value: 35 },
        { type: 'RelativeHumidityDehumidifierThreshold', value: 60 },
      ])
    })

    describe('the colour of the fan slider', () => {
      async function gradient(options: Parameters<typeof unit>[0]) {
        const { container } = renderManage(HumidifierDehumidifierManage, unit({ fanSpeed: 50, ...options }))
        await flushDebounce(20)
        return (container.querySelector('.fan-slider .noUi-target') as HTMLElement).style.background
      }

      it('is grey while the unit is off', async () => {
        // Nothing is running, so a coloured slider would suggest it is
        expect(await gradient({ active: 0 })).toContain('rgb(192, 192, 192)')
      })

      it.each([
        ['humidifying', 1, 'rgb(173, 216, 230)'],
        ['dehumidifying', 2, 'rgb(255, 185, 120)'],
        ['in auto', 0, 'rgb(144, 238, 144)'],
      ])('follows the mode when %s', async (_case, mode, colour) => {
        expect(await gradient({ mode })).toContain(colour)
      })
    })
  })
  describe('air purifier', () => {
    /** An air purifier reporting power as `Active`, which most do. */
    function purifier(options: { active?: number, mode?: number, speed?: number } = {}) {
      return hapService({
        type: 'AirPurifier',
        characteristics: [
          characteristic('Active', options.active ?? 1),
          characteristic('TargetAirPurifierState', options.mode ?? 1, { validValues: [0, 1] }),
          characteristic('RotationSpeed', options.speed ?? 50, { minValue: 0, maxValue: 100, minStep: 1 }),
        ],
      })
    }

    /** An air purifier exposing a plain `On` switch instead. */
    function onOffPurifier(on = true, speed = 50) {
      return hapService({
        type: 'AirPurifier',
        characteristics: [
          characteristic('On', on),
          characteristic('RotationSpeed', speed, { minValue: 0, maxValue: 100, minStep: 1 }),
        ],
      })
    }

    function modeButtons(container: HTMLElement) {
      return [...container.querySelectorAll('[aria-label="accessories.control.mode_control"] .btn-control')].map(b => b.textContent?.trim())
    }

    it('reads the power state from Active', () => {
      expect(isChecked(renderManage(AirPurifierManage, purifier({ active: 1 })).container, 'accessories.control.on')).toBe(true)
      expect(isChecked(renderManage(AirPurifierManage, purifier({ active: 0 })).container, 'accessories.control.off')).toBe(true)
    })

    it('reads the power state from On when that is all there is', () => {
      expect(isChecked(renderManage(AirPurifierManage, onOffPurifier(true)).container, 'accessories.control.on')).toBe(true)
      expect(isChecked(renderManage(AirPurifierManage, onOffPurifier(false)).container, 'accessories.control.off')).toBe(true)
    })

    it('writes a number to Active', () => {
      const service = purifier({ active: 0 })
      const { container } = renderManage(AirPurifierManage, service)

      clickButton(container, 'accessories.control.on')

      expect(writesTo(service)).toEqual([{ type: 'Active', value: 1 }])
    })

    it('writes a boolean to On when that is all there is', () => {
      const service = onOffPurifier(false)
      const { container } = renderManage(AirPurifierManage, service)

      clickButton(container, 'accessories.control.on')

      expect(writesTo(service)).toEqual([{ type: 'On', value: true }])
    })

    it('writes the auto or manual choice to TargetAirPurifierState', () => {
      const service = purifier()
      const { container } = renderManage(AirPurifierManage, service)

      clickButton(container, 'accessories.control.manual')

      expect(writesTo(service)).toEqual([{ type: 'TargetAirPurifierState', value: 0 }])
      expect(isChecked(container, 'accessories.control.manual')).toBe(true)
    })

    it('switches the purifier on when the speed is raised off zero', async () => {
      const service = purifier({ active: 0, speed: 0 })
      const { container } = renderManage(AirPurifierManage, service)

      slideTo(container, '', 40)
      await flushDebounce()

      expect(writesTo(service)).toEqual([
        { type: 'RotationSpeed', value: 40 },
        { type: 'Active', value: 1 },
      ])
      expect(isChecked(container, 'accessories.control.on')).toBe(true)
    })

    it('switches the purifier off when the speed is dragged to zero', async () => {
      const service = purifier({ active: 1, speed: 50 })
      const { container } = renderManage(AirPurifierManage, service)

      slideTo(container, '', 0)
      await flushDebounce()

      expect(writesTo(service)).toEqual([
        { type: 'RotationSpeed', value: 0 },
        { type: 'Active', value: 0 },
      ])
    })

    it('offers only the modes the accessory supports', () => {
      const { container } = renderManage(AirPurifierManage, purifier())

      expect(modeButtons(container)).toEqual(['accessories.control.manual', 'accessories.control.auto'])
    })

    it('switches an on-off purifier on with a boolean when the speed is raised', async () => {
      // ⚠️ The two cases above go through the `Active` arm. A purifier with only
      // an `On` switch takes the arm beside it, and a number written there is
      // refused by HAP - the speed moves and the purifier stays off
      const service = onOffPurifier(false, 0)
      const { container } = renderManage(AirPurifierManage, service)

      slideTo(container, '', 40)
      await flushDebounce()

      expect(writesTo(service)).toEqual([
        { type: 'RotationSpeed', value: 40 },
        { type: 'On', value: true },
      ])
    })

    it('switches an on-off purifier off with a boolean when the speed reaches zero', async () => {
      const service = onOffPurifier(true, 50)
      const { container } = renderManage(AirPurifierManage, service)

      slideTo(container, '', 0)
      await flushDebounce()

      expect(writesTo(service)).toEqual([
        { type: 'RotationSpeed', value: 0 },
        { type: 'On', value: false },
      ])
    })

    it.each([
      ['one reporting Active', () => purifier({ active: 1, speed: 50 }), () => purifier({ active: 0, mode: 0, speed: 20 })],
      ['one reporting On', () => onOffPurifier(true, 50), () => onOffPurifier(false, 20)],
    ])('follows a change made elsewhere on %s', (_case, initial, changed) => {
      const view = renderManage(AirPurifierManage, initial())

      view.pushUpdate(changed())

      expect(isChecked(view.container, 'accessories.control.off')).toBe(true)
      expect(sliderApi(view.container)!.get()).toBe('20')
    })

    it('offers no mode buttons to a purifier with no auto mode', () => {
      const { container } = renderManage(AirPurifierManage, onOffPurifier())

      expect(container.textContent).not.toContain('accessories.control.mode')
    })
  })
})
