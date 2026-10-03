import type {
  ColorTemperatureControlConfig,
  ServiceTypeX,
  SimpleValueControlConfig,
  SliderControlConfig,
} from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { AdaptiveLightingSignal } from '@/core/accessories/types/hap/lightbulb/adaptive-lighting'
import type { MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAdaptiveLighting } from '@/core/accessories/types/hap/lightbulb/adaptive-lighting'
import { ManageModal } from '@/core/accessories/types/hap/manage-parts'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'
import { useLatest } from '@/core/hooks/use-latest'
import { convertMired } from '@/core/pipes/convert-mired'
import { colour } from '@/core/utilities/colour'
import { cx } from '@/core/utilities/cx'

export type LightbulbManageProps = HapManageProps & {
  /** Only passed for a bulb with adaptive lighting: the tile's live "is it on" signal. */
  adaptiveLighting?: AdaptiveLightingSignal
}

function loadTargetBrightness(service: ServiceTypeX): SliderControlConfig | undefined {
  const brightness = service.getCharacteristic!('Brightness')
  if (!brightness) {
    return undefined
  }
  return {
    value: brightness.value as number,
    min: brightness.minValue,
    max: brightness.maxValue,
    step: brightness.minStep,
  }
}

function loadSimple(service: ServiceTypeX, type: string): SimpleValueControlConfig | undefined {
  const char = service.getCharacteristic!(type)
  return char ? { value: char.value as number } : undefined
}

function loadTargetColorTemperature(service: ServiceTypeX): ColorTemperatureControlConfig | undefined {
  const colorTemperature = service.getCharacteristic!('ColorTemperature')
  if (!colorTemperature) {
    return undefined
  }
  // Here, the min and max are switched because mired and kelvin are inversely related
  return {
    value: colour.miredToKelvin(colorTemperature.value as number),
    mired: colorTemperature.value as number,
    min: colour.miredToKelvin(colorTemperature.maxValue as number),
    max: colour.miredToKelvin(colorTemperature.minValue as number),
    step: colorTemperature.minStep,
  }
}

const HUE_GRADIENT = `linear-gradient(to right,
        hsl(0, 100%, 50%),
        hsl(60, 100%, 50%),
        hsl(120, 100%, 50%),
        hsl(180, 100%, 50%),
        hsl(240, 100%, 50%),
        hsl(300, 100%, 50%),
        hsl(360, 100%, 50%))`

function saturationGradient(hue: number | undefined): string {
  const h = hue || 0
  // White at zero saturation, not grey - matching how the tile paints the bulb
  return `linear-gradient(to right,
      ${colour.hueSaturationToHsl(h, 0)},
      ${colour.hueSaturationToHsl(h, 100)})`
}

export function LightbulbManage({ service: initialService, activeModal, adaptiveLighting }: LightbulbManageProps) {
  const { t } = useTranslation()
  const hasAdaptiveLighting = !!adaptiveLighting
  const adaptiveOn = useAdaptiveLighting(adaptiveLighting)

  const [targetMode, setTargetMode] = useState<boolean>(() => initialService.values.On)
  const [targetBrightness, setTargetBrightness] = useState(() => loadTargetBrightness(initialService))
  const [targetHue, setTargetHue] = useState(() => loadSimple(initialService, 'Hue'))
  const [targetSaturation, setTargetSaturation] = useState(() => loadSimple(initialService, 'Saturation'))
  const [targetColorTemperature, setTargetColorTemperature] = useState(() => loadTargetColorTemperature(initialService))

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => {
      if (targetBrightness) {
        m.applySliderGradient('linear-gradient(to right, #242424, #ffd6aa)', '.brightness-slider .noUi-target')
      }
      if (targetHue) {
        m.applySliderGradient(HUE_GRADIENT, '.hue-slider .noUi-target')
      }
      if (targetSaturation) {
        m.applySliderGradient(saturationGradient(targetHue?.value), '.saturation-slider .noUi-target')
      }
      if (targetColorTemperature) {
        const minHsl = colour.kelvinToHsl(targetColorTemperature.min!)
        const maxHsl = colour.kelvinToHsl(targetColorTemperature.max!)
        m.applySliderGradient(`linear-gradient(to right, ${minHsl}, ${maxHsl})`, '.color-temp-slider .noUi-target')
      }
    },
    onUpdate: (service) => {
      setTargetMode(service.values.On)
      setTargetBrightness(prev => prev && { ...prev, value: service.getCharacteristic!('Brightness').value as number })
      setTargetHue(prev => prev && { ...prev, value: service.getCharacteristic!('Hue').value as number })
      setTargetSaturation(prev => prev && { ...prev, value: service.getCharacteristic!('Saturation').value as number })
      setTargetColorTemperature((prev) => {
        if (!prev) {
          return prev
        }
        const colorTempValue = service.getCharacteristic!('ColorTemperature').value as number
        return { ...prev, value: colour.miredToKelvin(colorTempValue), mired: colorTempValue }
      })
    },
  })
  const live = useLatest(m.service)

  const onTargetMode = (value: boolean, event: MouseEvent) => {
    setTargetMode(value)
    void live.current.getCharacteristic!('On').setValue!(value)

    // Set the brightness to max if on 0% when turned on
    if (value && targetBrightness && !targetBrightness.value) {
      setTargetBrightness({ ...targetBrightness, value: live.current.getCharacteristic!('Brightness').maxValue as number })
    }

    m.blurTarget(event)
  }

  const onBrightnessStateChange = (value: number) => {
    setTargetBrightness(prev => prev && { ...prev, value })
    m.debounce('brightness', value, (brightness) => {
      const service = live.current
      void service.getCharacteristic!('Brightness').setValue!(brightness)

      // Turn the bulb on or off when brightness is adjusted
      if (brightness && !service.values.On) {
        setTargetMode(true)
        void service.getCharacteristic!('On').setValue!(true)
      } else if (!brightness && service.values.On) {
        setTargetMode(false)
        void service.getCharacteristic!('On').setValue!(false)
      }
    })
  }

  const onHueStateChange = (value: number) => {
    setTargetHue(prev => prev && { ...prev, value })
    m.debounce('hue', value, hue => void live.current.getCharacteristic!('Hue').setValue!(hue))
    m.applySliderGradient(saturationGradient(value), '.saturation-slider .noUi-target')
  }

  const onSaturationStateChange = (value: number) => {
    setTargetSaturation(prev => prev && { ...prev, value })
    m.debounce('saturation', value, saturation => void live.current.getCharacteristic!('Saturation').setValue!(saturation))
  }

  const onColorTemperatureStateChange = (value: number) => {
    const miredValue = colour.kelvinToMired(value)
    setTargetColorTemperature(prev => prev && { ...prev, value, mired: miredValue })
    m.debounce('colorTemperature', miredValue, mired => void live.current.getCharacteristic!('ColorTemperature').setValue!(mired))
  }

  const service = m.service
  const note = adaptiveOn && (
    <div className="d-flex text-center mt-0 mb-1">
      <span className="grey-text small">{t('accessories.control.adaptive_lighting_note')}</span>
    </div>
  )

  return (
    <ManageModal title={service.customName || service.serviceName} onClose={m.dismissModal}>
      <div className="modal-body text-center px-5">
        <div
          className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
          role="group"
          aria-label={t('accessories.control.mode_control')}
        >
          <button type="button" className="btn mb-0 mx-0 p-3 btn-control" onClick={event => onTargetMode(false, event)}>
            <div className="float-start primary-text">
              <i className={cx('fas fa-xl', !targetMode && 'fa-check-circle', targetMode && 'fa-blank')}></i>
            </div>
            {t('accessories.control.off')}
            <div className="float-end"><i className="fas fa-xl fa-blank"></i></div>
          </button>
          <button type="button" className="btn mb-0 mx-0 p-3 btn-control" onClick={event => onTargetMode(true, event)}>
            <div className="float-start primary-text">
              <i className={cx('fas fa-xl', targetMode && 'fa-check-circle', !targetMode && 'fa-blank')}></i>
            </div>
            {t('accessories.control.on')}
            <div className="float-end"><i className="fas fa-xl fa-blank"></i></div>
          </button>
          {hasAdaptiveLighting && <div></div>}
        </div>
        {hasAdaptiveLighting && (
          <div className="d-flex justify-content-center mb-0 p-0 mt-0 grey-outline">
            <div className="mb-0 mx-0 p-3 btn-read w-100 no-round-top">
              <div className="float-start primary-text">
                <i className={cx('fas fa-xl fa-sun', !adaptiveOn && 'off-text', adaptiveOn && 'on-text')}></i>
              </div>
              {t('accessories.control.adaptive_lighting')}
              {': '}
              {adaptiveOn ? 'ON' : 'OFF'}
              <div className="float-end"><i className="fas fa-xl fa-blank"></i></div>
            </div>
          </div>
        )}
        {targetBrightness && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.brightness')}
              {': '}
              {targetBrightness.value}
              %
            </h6>
            <div className="brightness-slider">
              <Slider
                min={targetBrightness.min!}
                max={targetBrightness.max!}
                step={targetBrightness.step!}
                value={targetBrightness.value}
                onChange={value => onBrightnessStateChange(value as number)}
              />
            </div>
          </>
        )}
        {targetHue && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.hue')}
              {': '}
              {targetHue.value}
              &deg;
            </h6>
            <div className="hue-slider">
              <Slider
                min={0}
                max={360}
                step={1}
                className={cx(adaptiveOn && 'mb-1') || undefined}
                value={targetHue.value}
                onChange={value => onHueStateChange(value as number)}
              />
            </div>
            {note}
          </>
        )}
        {targetSaturation && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.saturation')}
              {': '}
              {targetSaturation.value}
              %
            </h6>
            <div className="saturation-slider">
              <Slider
                min={0}
                max={100}
                step={1}
                className={cx(adaptiveOn && 'mb-1') || undefined}
                value={targetSaturation.value}
                onChange={value => onSaturationStateChange(value as number)}
              />
            </div>
            {note}
          </>
        )}
        {targetColorTemperature && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.color_temperature')}
              {': '}
              {convertMired(targetColorTemperature.mired)}
            </h6>
            <div className="color-temp-slider">
              <Slider
                min={targetColorTemperature.min!}
                max={targetColorTemperature.max!}
                step={targetColorTemperature.step!}
                className={cx(adaptiveOn && 'mb-1') || undefined}
                value={targetColorTemperature.value}
                onChange={value => onColorTemperatureStateChange(value as number)}
              />
            </div>
            {note}
          </>
        )}
      </div>
    </ManageModal>
  )
}
