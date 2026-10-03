import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { LightModeButtons, MatterManageModal } from '@/core/accessories/types/matter/matter-manage'
import {
  useMatterColorTemperatureActions,
  useMatterColorTemperatureState,
  useMatterLightActions,
  useMatterLightState,
} from '@/core/accessories/types/matter/use-matter-light'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'
import { convertMired } from '@/core/pipes/convert-mired'

export function ColorTemperatureLightManage({ service: initial, activeModal }: AccessoryManageModalProps) {
  const { t } = useTranslation()
  const serviceRef = useRef<ServiceTypeX>(initial)
  const light = useMatterLightState(initial)
  const ct = useMatterColorTemperatureState(initial)

  const manage = useManageAccessory(initial, {
    activeModal,
    onUpdate: (service) => {
      serviceRef.current = service
      light.sync(service)
      ct.sync(service)
    },
  })
  const { service, applySliderGradient } = manage
  const { onBrightnessChange, setTargetMode } = useMatterLightActions(manage, light, serviceRef)
  const { onColorTemperatureChange } = useMatterColorTemperatureActions(manage, ct, serviceRef)
  const targetColorTemperature = ct.targetColorTemperature!

  useEffect(() => {
    applySliderGradient('linear-gradient(to right, #242424, #ffd6aa)', '.brightness-slider .noUi-target')
  }, [applySliderGradient])

  if (!manage.ready) {
    return null
  }

  return (
    <MatterManageModal service={service} onDismiss={manage.dismissModal}>
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
      </div>
    </MatterManageModal>
  )
}
