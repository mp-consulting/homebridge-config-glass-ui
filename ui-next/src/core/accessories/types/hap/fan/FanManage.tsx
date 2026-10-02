import type { ServiceTypeX, SliderControlConfig } from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ManageHeader, ModeButton } from '@/core/accessories/types/hap/manage-parts'
import { useLatest } from '@/core/accessories/types/hap/use-latest'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'

function readMode(service: ServiceTypeX): boolean {
  return ('On' in service.values)
    ? service.values.On
    : service.values.Active === 1
}

/** Write on/off through On, or Active (as a number) for a fan that has no On. */
function writeMode(service: ServiceTypeX, on: boolean) {
  if ('On' in service.values) {
    void service.getCharacteristic!('On').setValue!(on)
  } else if ('Active' in service.values) {
    void service.getCharacteristic!('Active').setValue!(on ? 1 : 0)
  }
}

export function FanManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()

  const [hasRotationDirection] = useState(() => 'RotationDirection' in initialService.values)
  const [targetMode, setTargetMode] = useState(() => readMode(initialService))
  const [targetRotationSpeed, setTargetRotationSpeed] = useState<SliderControlConfig | undefined>(() => {
    const RotationSpeed = initialService.getCharacteristic!('RotationSpeed')
    return RotationSpeed
      ? {
          value: RotationSpeed.value as number,
          min: RotationSpeed.minValue,
          max: RotationSpeed.maxValue,
          step: RotationSpeed.minStep,
          unit: RotationSpeed.unit as SliderControlConfig['unit'],
        }
      : undefined
  })
  const targetModeRef = useLatest(targetMode)

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => {
      if (targetRotationSpeed) {
        m.applySliderGradient('linear-gradient(to right, #add8e6, #416bdf)')
      }
    },
    onUpdate: (service) => {
      setTargetMode(readMode(service))
      setTargetRotationSpeed(prev => prev && { ...prev, value: service.getCharacteristic!('RotationSpeed')?.value as number })
    },
  })
  const live = useLatest(m.service)

  const onTargetMode = (value: boolean, event: MouseEvent) => {
    setTargetMode(value)
    writeMode(live.current, value)

    // Set the rotation speed to max if on 0% when turned on
    if (value && targetRotationSpeed && !targetRotationSpeed.value) {
      setTargetRotationSpeed({ ...targetRotationSpeed, value: live.current.getCharacteristic!('RotationSpeed').maxValue as number })
    }

    m.blurTarget(event)
  }

  const onTargetRotationSpeedChange = (value: number) => {
    setTargetRotationSpeed(prev => prev && { ...prev, value })
    m.debounce('rotationSpeed', value, (speed) => {
      const service = live.current
      void service.getCharacteristic!('RotationSpeed').setValue!(speed)

      // Turn the fan on or off when rotation speed is adjusted
      if (speed && !targetModeRef.current) {
        setTargetMode(true)
        writeMode(service, true)
      } else if (!speed && targetModeRef.current) {
        setTargetMode(false)
        writeMode(service, false)
      }
    })
  }

  const setRotationDirection = (value: number, event: MouseEvent) => {
    void live.current.getCharacteristic!('RotationDirection').setValue!(value)
    m.blurTarget(event)
  }

  const service = m.service

  return (
    <div className="modal-content">
      <ManageHeader title={service.customName || service.serviceName} onClose={m.dismissModal} />
      <div className="modal-body text-center px-5">
        <div
          className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
          role="group"
          aria-label={t('accessories.control.mode_control')}
        >
          <ModeButton selected={!targetMode} onClick={event => onTargetMode(false, event)}>{t('accessories.control.off')}</ModeButton>
          <ModeButton selected={targetMode} onClick={event => onTargetMode(true, event)}>{t('accessories.control.on')}</ModeButton>
        </div>

        {hasRotationDirection && (
          <>
            <h6 className="mt-4">{t('accessories.control.rotation_direction')}</h6>
            <div
              className="btn-group-vertical d-flex justify-content-center mb-4 p-0"
              role="group"
              aria-label={t('accessories.control.direction_control')}
            >
              <ModeButton selected={service.values?.RotationDirection === 0} onClick={event => setRotationDirection(0, event)}>
                {t('accessories.control.rotation_clockwise')}
              </ModeButton>
              <ModeButton selected={service.values?.RotationDirection === 1} onClick={event => setRotationDirection(1, event)}>
                {t('accessories.control.rotation_c_clockwise')}
              </ModeButton>
            </div>
          </>
        )}
        {targetRotationSpeed && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.rotation_speed')}
              {': '}
              {targetRotationSpeed.value}
              {targetRotationSpeed.unit === 'percentage' && '%'}
            </h6>
            <Slider
              min={targetRotationSpeed.min!}
              max={targetRotationSpeed.max!}
              step={targetRotationSpeed.step!}
              value={targetRotationSpeed.value}
              onChange={value => onTargetRotationSpeedChange(value as number)}
            />
          </>
        )}
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
