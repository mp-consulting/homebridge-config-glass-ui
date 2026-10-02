import type { ServiceTypeX, SliderControlConfig } from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ManageHeader, ModeButton } from '@/core/accessories/types/hap/manage-parts'
import { useLatest } from '@/core/accessories/types/hap/use-latest'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'

function readState(service: ServiceTypeX): number {
  return 'Active' in service.values
    ? service.values.Active
    : (service.values.On ? 1 : 0)
}

/** Write the on/off state through Active, or On for a purifier published as a switch. */
function writeState(service: ServiceTypeX, state: number) {
  if ('Active' in service.values) {
    void service.getCharacteristic!('Active').setValue!(state)
  } else if ('On' in service.values) {
    void service.getCharacteristic!('On').setValue!(state === 1)
  }
}

export function AirPurifierManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()

  const [targetModeValidValues] = useState<number[]>(() => 'TargetAirPurifierState' in initialService.values
    ? initialService.getCharacteristic!('TargetAirPurifierState').validValues as number[]
    : [])
  const [targetState, setTargetState] = useState(() => readState(initialService))
  const [targetMode, setTargetMode] = useState<number>(() => initialService.values.TargetAirPurifierState)
  const [targetRotationSpeed, setTargetRotationSpeed] = useState<SliderControlConfig | undefined>(() => {
    const RotationSpeed = initialService.getCharacteristic!('RotationSpeed')
    return RotationSpeed
      ? { value: RotationSpeed.value as number, min: RotationSpeed.minValue, max: RotationSpeed.maxValue, step: RotationSpeed.minStep }
      : undefined
  })
  const targetStateRef = useLatest(targetState)

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => {
      if (targetRotationSpeed) {
        m.applySliderGradient('linear-gradient(to right, #add8e6, #416bdf)')
      }
    },
    onUpdate: (service) => {
      setTargetState(readState(service))
      setTargetMode(service.values.TargetAirPurifierState)
      setTargetRotationSpeed(prev => prev && { ...prev, value: service.getCharacteristic!('RotationSpeed')?.value as number })
    },
  })
  const live = useLatest(m.service)

  const onTargetState = (value: number, event: MouseEvent) => {
    setTargetState(value)
    writeState(live.current, value)
    m.blurTarget(event)
  }

  const onTargetMode = (value: number, event: MouseEvent) => {
    setTargetMode(value)
    void live.current.getCharacteristic!('TargetAirPurifierState').setValue!(value)
    m.blurTarget(event)
  }

  const onTargetRotationSpeedChange = (value: number) => {
    setTargetRotationSpeed(prev => prev && { ...prev, value })
    m.debounce('rotationSpeed', value, (speed) => {
      const service = live.current
      void service.getCharacteristic!('RotationSpeed').setValue!(speed)

      // Turn the air purifier on or off when rotation speed is adjusted
      if (speed && !targetStateRef.current) {
        setTargetState(1)
        writeState(service, 1)
      } else if (!speed && targetStateRef.current) {
        setTargetState(0)
        writeState(service, 0)
      }
    })
  }

  const service = m.service

  return (
    <div className="modal-content">
      <ManageHeader title={service.customName || service.serviceName} onClose={m.dismissModal} />
      <div className="modal-body text-center px-5">
        <div
          className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
          role="group"
          aria-label={t('accessories.control.state_control')}
        >
          <ModeButton selected={targetState === 0} onClick={event => onTargetState(0, event)}>{t('accessories.control.off')}</ModeButton>
          <ModeButton selected={targetState === 1} onClick={event => onTargetState(1, event)}>{t('accessories.control.on')}</ModeButton>
        </div>
        {!!targetModeValidValues.length && (
          <>
            <h6 className="mt-4">{t('accessories.control.mode')}</h6>
            <div
              className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
              role="group"
              aria-label={t('accessories.control.mode_control')}
            >
              {targetModeValidValues.includes(0) && (
                <ModeButton selected={targetMode === 0} onClick={event => onTargetMode(0, event)}>{t('accessories.control.manual')}</ModeButton>
              )}
              {targetModeValidValues.includes(1) && (
                <ModeButton selected={targetMode === 1} onClick={event => onTargetMode(1, event)}>{t('accessories.control.auto')}</ModeButton>
              )}
            </div>
          </>
        )}
        {targetRotationSpeed && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.rotation_speed')}
              {': '}
              {targetRotationSpeed.value}
              %
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
