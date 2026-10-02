import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'
import type { MouseEvent } from 'react'

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { getFanPercentSetting, isFanOn, setFanSpeed } from '@/core/accessories/types/matter/matter-device.utils'
import { LightModeButtons, MatterManageHeader } from '@/core/accessories/types/matter/matter-manage'
import { useStateRef } from '@/core/accessories/types/matter/use-state-ref'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'

const SPEED_RANGE = { min: 0, max: 100, step: 1 }

/** The Matter fan modal (Angular `MatterFanManageComponent`). */
export function MatterFanManage({ service: initial, activeModal }: AccessoryManageModalProps) {
  const { t } = useTranslation()
  const serviceRef = useRef<ServiceTypeX>(initial)
  const [targetMode, setTargetModeState, targetModeRef] = useStateRef(() => isFanOn(initial))
  const [speed, setSpeed, speedRef] = useStateRef(() => getFanPercentSetting(initial))

  const manage = useManageAccessory(initial, {
    activeModal,
    onUpdate: (service) => {
      serviceRef.current = service
      setTargetModeState(isFanOn(service))
      setSpeed(getFanPercentSetting(service))
    },
  })
  const { service, applySliderGradient, debounce, showGenericErrorToast, blurTarget } = manage

  useEffect(() => {
    applySliderGradient('linear-gradient(to right, #add8e6, #416bdf)')
  }, [applySliderGradient])

  const writeSpeed = async () => {
    const previousSpeed = getFanPercentSetting(serviceRef.current)
    try {
      await setFanSpeed(serviceRef.current, speedRef.current)
    } catch (error) {
      showGenericErrorToast(error)
      // Revert to previous value on error
      setSpeed(previousSpeed)
      setTargetModeState(previousSpeed > 0)
    }
  }

  const onTargetSpeedChange = (value: number) => {
    setSpeed(value)
    debounce('speed', value, () => void writeSpeed())

    // Update targetMode based on speed
    setTargetModeState(value > 0)
  }

  const setTargetMode = async (value: boolean, event: MouseEvent) => {
    const previousMode = targetModeRef.current
    const previousSpeed = speedRef.current

    try {
      setTargetModeState(value)

      if (value) {
        // Turn on - set to 100% if currently 0%
        const next = speedRef.current || 100
        await setFanSpeed(serviceRef.current, next)
        setSpeed(next)
      } else {
        // Turn off
        await setFanSpeed(serviceRef.current, 0)
        setSpeed(0)
      }

      blurTarget(event)
    } catch (error) {
      showGenericErrorToast(error)
      // Revert to previous state on error
      setTargetModeState(previousMode)
      setSpeed(previousSpeed)
    }
  }

  if (!manage.ready) {
    return null
  }

  return (
    <div className="modal-content">
      <MatterManageHeader service={service} onDismiss={manage.dismissModal} />
      <div className="modal-body text-center px-5">
        <LightModeButtons targetMode={targetMode} setTargetMode={(value, event) => void setTargetMode(value, event)} />

        <h6 className="mt-4">
          {t('accessories.control.rotation_speed')}
          :
          {' '}
          {speed}
          %
        </h6>
        <Slider
          min={SPEED_RANGE.min}
          max={SPEED_RANGE.max}
          step={SPEED_RANGE.step}
          value={speed}
          onChange={value => onTargetSpeedChange(value as number)}
        />
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
