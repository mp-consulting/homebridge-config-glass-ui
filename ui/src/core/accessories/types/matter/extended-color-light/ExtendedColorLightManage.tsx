import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'

import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { getHue, getSaturation, hasClusterFeature, hasColorTemperature } from '@/core/accessories/types/matter/matter-device.utils'
import { LightModeButtons, MatterManageModal } from '@/core/accessories/types/matter/matter-manage'
import {
  useMatterColorTemperatureActions,
  useMatterColorTemperatureState,
  useMatterLightActions,
  useMatterLightState,
} from '@/core/accessories/types/matter/use-matter-light'
import { useStateRef } from '@/core/accessories/types/matter/use-state-ref'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'
import { convertMired } from '@/core/pipes/convert-mired'
import { colour } from '@/core/utilities/colour'

import './extended-color-light-manage.scss'

function supportsColorTemperatureOf(service: ServiceTypeX): boolean {
  return hasClusterFeature(service, 'colorControl', 'colorTemperature', hasColorTemperature(service))
}

/**
 * Hue and saturation ride on the HueSaturation feature. An ExtendedColorLight
 * normally has it, but a plugin composing ColorControl itself may not, and
 * writing hue to a cluster without the feature is rejected.
 */
function supportsHueSaturationOf(service: ServiceTypeX): boolean {
  return hasClusterFeature(
    service,
    'colorControl',
    'hueSaturation',
    service.clusters?.colorControl?.currentHue !== undefined,
  )
}

const HUE_RANGE = { min: 0, max: 254, step: 1 }

export function ExtendedColorLightManage({ service: initial, activeModal }: AccessoryManageModalProps) {
  const { t } = useTranslation()
  const serviceRef = useRef<ServiceTypeX>(initial)
  const light = useMatterLightState(initial)
  // A plugin can compose ColorControl with only some of its features, so the
  // colour temperature slider is only set up when the light has it
  const ct = useMatterColorTemperatureState(initial, supportsColorTemperatureOf(initial))
  const [hue, setHue, hueRef] = useStateRef(() => getHue(initial))
  const [saturation, setSaturation, saturationRef] = useStateRef(() => getSaturation(initial))

  const applyGradientRef = useRef<(gradient: string, selector?: string) => void>(() => {})

  /** Update the saturation slider gradient to match the current hue */
  const updateSaturationSliderGradient = useCallback(() => {
    const hDegrees = (hueRef.current / 254) * 360
    applyGradientRef.current(`linear-gradient(to right, ${colour.hueSaturationToHsl(hDegrees, 0)}, ${colour.hueSaturationToHsl(hDegrees, 100)})`, '.saturation-slider .noUi-target')
  }, [hueRef])

  const manage = useManageAccessory(initial, {
    activeModal,
    onUpdate: (service) => {
      serviceRef.current = service
      light.sync(service)
      if (supportsColorTemperatureOf(service)) {
        ct.sync(service)
      }

      // The hue slider's gradient is rebuilt only when the hue itself moves,
      // so the sliders do not redraw on every unrelated poll
      const newHue = getHue(service)
      if (hueRef.current !== newHue) {
        setHue(newHue)
        updateSaturationSliderGradient()
      }

      setSaturation(getSaturation(service))
    },
  })
  const { service, applySliderGradient, debounce, showGenericErrorToast } = manage
  applyGradientRef.current = applySliderGradient
  const { onBrightnessChange, setTargetMode } = useMatterLightActions(manage, light, serviceRef)
  const { onColorTemperatureChange } = useMatterColorTemperatureActions(manage, ct, serviceRef)

  useEffect(() => {
    applySliderGradient('linear-gradient(to right, #242424, #ffd6aa)', '.brightness-slider .noUi-target')
    applySliderGradient('linear-gradient(to right, hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%), hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%))', '.hue-slider .noUi-target')
    updateSaturationSliderGradient()
  }, [applySliderGradient, updateSaturationSliderGradient])

  /**
   * Both sliders send hue AND saturation: the cluster needs the pair. Both
   * revert both on a refused write, or the screen would claim a colour the
   * light never received.
   * @param fromHue - whether the hue slider sent it (it also redraws the saturation gradient on a revert)
   */
  const writeHueSaturation = useCallback(async (fromHue: boolean) => {
    const previousHue = getHue(serviceRef.current)
    const previousSaturation = getSaturation(serviceRef.current)
    try {
      const cluster = serviceRef.current.getCluster?.('colorControl')
      if (!cluster) {
        throw new Error('ColorControl cluster not found')
      }
      await cluster.setAttributes({
        currentHue: hueRef.current,
        currentSaturation: saturationRef.current,
      })
    } catch (error) {
      showGenericErrorToast(error)
      setHue(previousHue)
      setSaturation(previousSaturation)
      if (fromHue) {
        updateSaturationSliderGradient()
      }
    }
  }, [hueRef, saturationRef, setHue, setSaturation, showGenericErrorToast, updateSaturationSliderGradient])

  const onHueChange = (value: number) => {
    setHue(value)
    debounce('hue', value, () => void writeHueSaturation(true), 300)
    updateSaturationSliderGradient()
  }

  const onSaturationChange = (value: number) => {
    setSaturation(value)
    debounce('saturation', value, () => void writeHueSaturation(false), 300)
  }

  if (!manage.ready) {
    return null
  }

  const supportsColorTemperature = supportsColorTemperatureOf(service)
  const supportsHueSaturation = supportsHueSaturationOf(service)
  const targetColorTemperature = ct.targetColorTemperature

  return (
    <MatterManageModal service={service} onDismiss={manage.dismissModal} className="hb-matter-extended-color-light-manage">
      <div className="modal-body text-center px-5">
        <LightModeButtons targetMode={light.targetMode} setTargetMode={setTargetMode} />
        <h6 className="mt-4">
          {t('accessories.control.brightness')}
          :
          {' '}
          {light.brightnessPercentage}
          %
        </h6>
        <div className="brightness-slider">
          <Slider
            min={light.targetBrightness.min}
            max={light.targetBrightness.max}
            step={light.targetBrightness.step}
            value={light.targetBrightness.value}
            onChange={value => onBrightnessChange(value as number)}
          />
        </div>
        {supportsColorTemperature && targetColorTemperature && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.color_temperature')}
              :
              {' '}
              {convertMired(targetColorTemperature.mired)}
            </h6>
            <div className="color-temp-slider">
              <Slider
                min={targetColorTemperature.min}
                max={targetColorTemperature.max}
                step={targetColorTemperature.step}
                value={targetColorTemperature.value}
                onChange={value => onColorTemperatureChange(value as number)}
              />
            </div>
          </>
        )}
        {supportsHueSaturation && (
          <>
            <h6 className="mt-3">
              {t('accessories.control.hue')}
              :
              {' '}
              {Math.round((hue / 254) * 100)}
              %
            </h6>
            <div className="hue-slider">
              <Slider
                min={HUE_RANGE.min}
                max={HUE_RANGE.max}
                step={HUE_RANGE.step}
                value={hue}
                onChange={value => onHueChange(value as number)}
              />
            </div>
            <h6 className="mt-3">
              {t('accessories.control.saturation')}
              :
              {' '}
              {Math.round((saturation / 254) * 100)}
              %
            </h6>
            <div className="saturation-slider">
              <Slider
                min={HUE_RANGE.min}
                max={HUE_RANGE.max}
                step={HUE_RANGE.step}
                value={saturation}
                onChange={value => onSaturationChange(value as number)}
              />
            </div>
          </>
        )}
      </div>
    </MatterManageModal>
  )
}
