import type { SliderControlConfig } from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ManageModal, ModeButton } from '@/core/accessories/types/hap/manage-parts'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'
import { useLatest } from '@/core/hooks/use-latest'

/**
 * The speaker, microphone and doorbell modals (three identical copies in
 * Angular): power or media buttons, the mute switch and the volume.
 * `guardUpdate`: the speaker only reads Volume on an update when the accessory
 * still reports it; the other two read it unguarded.
 */
export function MediaManage({ service: initialService, activeModal, guardUpdate = false }: HapManageProps & { guardUpdate?: boolean }) {
  const { t } = useTranslation()

  // The switch on these is mute, so an unmuted accessory shows "not muted"
  const [targetMode, setTargetMode] = useState<boolean>(() => initialService.values.Mute)
  const [targetVolume, setTargetVolume] = useState<SliderControlConfig | undefined>(() => {
    const volume = initialService.getCharacteristic!('Volume')
    return volume
      ? { value: volume.value as number, min: volume.minValue, max: volume.maxValue, step: volume.minStep }
      : undefined
  })

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => {
      if (targetVolume) {
        m.applySliderGradient('linear-gradient(to right, #ffffff, #ffd966, #ff0000)')
      }
    },
    onUpdate: (service) => {
      setTargetMode(service.values.Mute)
      if (!guardUpdate || 'Volume' in service.values) {
        setTargetVolume(prev => prev && { ...prev, value: service.getCharacteristic!('Volume')?.value as number })
      }
    },
  })
  const live = useLatest(m.service)

  const onTargetMode = (value: boolean, event: MouseEvent) => {
    setTargetMode(value)
    void live.current.getCharacteristic!('Mute').setValue!(value)
    m.blurTarget(event)
  }

  const setActive = (value: number, event: MouseEvent) => {
    void live.current.getCharacteristic!('Active').setValue!(value)
    m.blurTarget(event)
  }

  const setTargetState = (value: number, event: MouseEvent) => {
    void live.current.getCharacteristic!('TargetMediaState').setValue!(value)
    m.blurTarget(event)
  }

  const onVolumeStateChange = (value: number) => {
    setTargetVolume(prev => prev && { ...prev, value })
    m.debounce('volume', value, volume => void live.current.getCharacteristic!('Volume').setValue!(volume))
  }

  const service = m.service
  const values = service.values

  return (
    <ManageModal title={service.customName || service.serviceName} onClose={m.dismissModal}>
      <div className="modal-body text-center px-5">
        {'Active' in values
          ? (
              <div
                className="btn-group-vertical d-flex justify-content-center mb-4 p-0"
                role="group"
                aria-label={t('accessories.control.mode_control')}
              >
                <ModeButton selected={values?.Active === 0} onClick={event => setActive(0, event)}>{t('accessories.control.off')}</ModeButton>
                <ModeButton selected={values?.Active === 1} onClick={event => setActive(1, event)}>{t('accessories.control.on')}</ModeButton>
              </div>
            )
          : 'TargetMediaState' in values && (
            <div
              className="btn-group-vertical d-flex justify-content-center mb-4 p-0"
              role="group"
              aria-label={t('accessories.control.media_control')}
            >
              <ModeButton selected={values?.CurrentMediaState === 0} onClick={event => setTargetState(0, event)}>{t('accessories.control.play')}</ModeButton>
              <ModeButton selected={values?.CurrentMediaState === 1} onClick={event => setTargetState(1, event)}>{t('accessories.control.pause')}</ModeButton>
              <ModeButton selected={values?.CurrentMediaState === 2} onClick={event => setTargetState(2, event)}>{t('accessories.control.stop')}</ModeButton>
            </div>
          )}
        {'Mute' in values && (
          <>
            <h6>
              {t('Active' in values || 'TargetMediaState' in values ? 'accessories.control.speaker_volume' : 'menu.label_status')}
            </h6>
            <div
              className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
              role="group"
              aria-label={t('accessories.control.mute_control')}
            >
              <ModeButton selected={!targetMode} onClick={event => onTargetMode(false, event)}>{t('accessories.control.not_mute')}</ModeButton>
              <ModeButton selected={targetMode} onClick={event => onTargetMode(true, event)}>{t('accessories.control.mute')}</ModeButton>
            </div>
          </>
        )}
        {targetVolume && (
          <>
            <h6 className="mt-4 mb-0">
              {t('accessories.control.speaker_volume')}
              {': '}
              {targetVolume.value}
              %
            </h6>
            <Slider
              min={targetVolume.min!}
              max={targetVolume.max!}
              step={targetVolume.step!}
              value={targetVolume.value}
              onChange={value => onVolumeStateChange(value as number)}
            />
          </>
        )}
      </div>
    </ManageModal>
  )
}
