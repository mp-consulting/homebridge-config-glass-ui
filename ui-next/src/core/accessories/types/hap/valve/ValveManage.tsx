import type { SliderControlConfig } from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ManageHeader, ModeButton } from '@/core/accessories/types/hap/manage-parts'
import { useLatest } from '@/core/accessories/types/hap/use-latest'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'
import { duration } from '@/core/pipes/duration'

export function ValveManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()

  const [targetMode, setTargetMode] = useState<boolean>(() => initialService.values.Active)
  const [targetSetDuration, setTargetSetDuration] = useState<SliderControlConfig | undefined>(() => {
    const setDuration = initialService.getCharacteristic!('SetDuration')
    return setDuration
      ? { value: setDuration.value as number, min: setDuration.minValue, max: setDuration.maxValue, step: setDuration.minStep }
      : undefined
  })

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => {
      if (targetSetDuration) {
        m.applySliderGradient('linear-gradient(to right, #add8e6, #416bdf)', '.noUi-target')
      }
    },
    onUpdate: (service) => {
      setTargetMode(service.values.Active)
      if ('SetDuration' in service.values) {
        setTargetSetDuration(prev => prev && { ...prev, value: service.getCharacteristic!('SetDuration').value as number })
      }
    },
  })
  const live = useLatest(m.service)

  // (Writes a boolean to Active, as the Angular modal did)
  const onTargetMode = (value: boolean, event: MouseEvent) => {
    setTargetMode(value)
    void live.current.getCharacteristic!('Active').setValue!(value)
    m.blurTarget(event)
  }

  const onSetDurationStateChange = (value: number) => {
    setTargetSetDuration(prev => prev && { ...prev, value })
    m.debounce('setDuration', value, seconds => void live.current.getCharacteristic!('SetDuration').setValue!(seconds))
  }

  const service = m.service

  return (
    <div className="modal-content">
      <ManageHeader title={service.customName || service.serviceName} onClose={m.dismissModal} />
      <div className="modal-body text-center px-5">
        <div
          className="btn-group-vertical d-flex justify-content-center mb-4 p-0"
          role="group"
          aria-label={t('accessories.control.mode_control')}
        >
          <ModeButton selected={!targetMode} onClick={event => onTargetMode(false, event)}>{t('accessories.control.off')}</ModeButton>
          <ModeButton selected={!!targetMode} onClick={event => onTargetMode(true, event)}>{t('accessories.control.on')}</ModeButton>
        </div>

        {targetSetDuration && (
          <>
            <h6>
              {t('accessories.control.set_duration')}
              {': '}
              {targetSetDuration.value === 0 ? '∞' : duration(targetSetDuration.value)}
            </h6>
            <Slider
              min={targetSetDuration.min!}
              max={targetSetDuration.max!}
              step={15}
              value={targetSetDuration.value}
              onChange={value => onSetDurationStateChange(value as number)}
            />
          </>
        )}
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
