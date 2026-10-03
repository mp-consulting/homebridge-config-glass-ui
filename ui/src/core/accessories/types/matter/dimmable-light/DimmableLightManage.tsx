import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { LightModeButtons, MatterManageHeader } from '@/core/accessories/types/matter/matter-manage'
import { useMatterLightActions, useMatterLightState } from '@/core/accessories/types/matter/use-matter-light'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'

export function DimmableLightManage({ service: initial, activeModal }: AccessoryManageModalProps) {
  const { t } = useTranslation()
  const serviceRef = useRef<ServiceTypeX>(initial)
  const light = useMatterLightState(initial)

  const manage = useManageAccessory(initial, {
    activeModal,
    onUpdate: (service) => {
      serviceRef.current = service
      light.sync(service)
    },
  })
  const { service, applySliderGradient } = manage
  const { onBrightnessChange, setTargetMode } = useMatterLightActions(manage, light, serviceRef)

  useEffect(() => {
    applySliderGradient('linear-gradient(to right, #242424, #ffd6aa)')
  }, [applySliderGradient])

  if (!manage.ready) {
    return null
  }

  return (
    <div className="modal-content">
      <MatterManageHeader service={service} onDismiss={manage.dismissModal} />
      <div className="modal-body text-center px-5">
        <LightModeButtons targetMode={light.targetMode} setTargetMode={setTargetMode} />
        <h6 className="mt-4">
          {t('accessories.control.brightness')}
          :
          {' '}
          {light.brightnessPercentage}
          %
        </h6>
        <Slider
          min={light.targetBrightness.min}
          max={light.targetBrightness.max}
          step={light.targetBrightness.step}
          value={light.targetBrightness.value}
          onChange={value => onBrightnessChange(value as number)}
        />
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
