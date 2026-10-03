import type { ServiceTypeX, SliderControlConfig } from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ManageModal, ModeButton } from '@/core/accessories/types/hap/manage-parts'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'
import { useLatest } from '@/core/hooks/use-latest'
import { duration } from '@/core/pipes/duration'

/** The LockManagement service the accessories service links in beside the mechanism. */
function managementOf(service: ServiceTypeX): ServiceTypeX | undefined {
  if (!service.linkedServices) {
    return undefined
  }
  return Object.values(service.linkedServices).find(s => s.type === 'LockManagement') as ServiceTypeX | undefined
}

export function LockMechanismManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()

  const [serviceManagement] = useState(() => managementOf(initialService))
  const [targetMode, setTargetMode] = useState<number>(() => initialService.values.LockTargetState)
  const [timeoutControl, setTimeoutControl] = useState<SliderControlConfig | undefined>(() => {
    const characteristic = serviceManagement?.getCharacteristic!('LockManagementAutoSecurityTimeout')
    return characteristic
      ? {
          value: (characteristic.value as number) || 0,
          min: characteristic.minValue || 0,
          max: characteristic.maxValue || 3600,
          step: characteristic.minStep || 10,
        }
      : undefined
  })
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => {
      if (timeoutControl) {
        m.applySliderGradient('linear-gradient(to right, #ffffff, #ffd966, #ff0000)')
      }
    },
    onUpdate: (service) => {
      setTargetMode(service.values.LockTargetState)
      if (serviceManagement) {
        setTimeoutControl(prev => prev && { ...prev, value: serviceManagement.getCharacteristic!('LockManagementAutoSecurityTimeout')?.value as number })
      }
    },
  })
  const live = useLatest(m.service)

  // The relock prediction dies with the modal
  useEffect(() => () => clearTimeout(lockTimerRef.current), [])

  const onTargetMode = (value: number, event: MouseEvent) => {
    setTargetMode(value)
    void live.current.getCharacteristic!('LockTargetState').setValue!(value)

    // Cancel any existing lock timer
    clearTimeout(lockTimerRef.current)

    // Unlocked with an auto-relock time: the accessory re-locks on its own, so
    // predict it, or the switch stays showing unlocked
    if (value === 0 && timeoutControl && timeoutControl.value > 0) {
      lockTimerRef.current = setTimeout(setTargetMode, (timeoutControl.value + 0.3) * 1000, 1)
    }

    m.blurTarget(event)
  }

  const onTimeoutChange = (value: number) => {
    setTimeoutControl(prev => prev && { ...prev, value })
    m.debounce('autoSecurityTimeout', value, (seconds) => {
      void serviceManagement!.getCharacteristic!('LockManagementAutoSecurityTimeout').setValue!(seconds)
    }, 300)
  }

  const service = m.service

  return (
    <ManageModal title={service.customName || service.serviceName} onClose={m.dismissModal}>
      <div className="modal-body text-center px-5">
        <div
          className="btn-group-vertical d-flex justify-content-center p-0"
          role="group"
          aria-label={t('accessories.control.mode_control')}
        >
          <ModeButton selected={targetMode === 1} onClick={event => onTargetMode(1, event)}>{t('accessories.control.lock')}</ModeButton>
          <ModeButton selected={targetMode === 0} onClick={event => onTargetMode(0, event)}>{t('accessories.control.unlock')}</ModeButton>
        </div>

        {serviceManagement && timeoutControl && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.lock_auto')}
              {': '}
              {timeoutControl.value === 0 ? '∞' : duration(timeoutControl.value)}
            </h6>
            <Slider
              min={timeoutControl.min!}
              max={timeoutControl.max!}
              step={10}
              value={timeoutControl.value}
              onChange={value => onTimeoutChange(value as number)}
            />
          </>
        )}
      </div>
    </ManageModal>
  )
}
