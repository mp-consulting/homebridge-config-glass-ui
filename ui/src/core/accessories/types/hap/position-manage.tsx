import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'

import { useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ManageModal } from '@/core/accessories/types/hap/manage-parts'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'
import { useLatest } from '@/core/hooks/use-latest'

interface PositionControl {
  value: number
  min: number
  max: number
  step: number
}

function loadControl(service: ServiceTypeX, name: string, defaultStep?: number): PositionControl | undefined {
  const characteristic = service.getCharacteristic!(name)
  if (!characteristic) {
    return undefined
  }
  return {
    value: characteristic.value as number,
    min: characteristic.minValue as number,
    max: characteristic.maxValue as number,
    step: defaultStep ? ((characteristic.minStep as number) || defaultStep) : characteristic.minStep as number,
  }
}

export interface PositionManageOptions {
  /** The door's modal announces the state and hides the duplicate headings from screen readers. */
  a11y?: boolean
  /** The window covering's modal also has the tilt sliders. */
  tilt?: boolean
  /**
   * How a live update reads TargetPosition: the door reads it unguarded, the
   * window and window covering only when the accessory still reports it.
   */
  guardUpdate?: boolean
}

/**
 * The door, window and window covering modals: three copies of one modal in
 * Angular, one body here. A target position slider, the current position
 * (read-only) and, on a blind, the tilt axes it has.
 */
export function PositionManage({ service: initialService, activeModal, a11y = false, tilt = false, guardUpdate = false }: HapManageProps & PositionManageOptions) {
  const { t } = useTranslation()
  // The modal writes PositionState locally (see below), which React cannot see
  const [, rerender] = useReducer((x: number) => x + 1, 0)

  const [targetPosition, setTargetPosition] = useState(() => loadControl(initialService, 'TargetPosition'))
  /**
   * Tilt is optional on the HomeKit WindowCovering service, and a blind has one
   * axis or the other rather than both, so each slider only appears when the
   * plugin actually added that characteristic. Angles are in degrees (normally
   * -90 to 90), not the percentage the position slider uses. The bounds come
   * from the characteristic, so an accessory that narrows them is respected.
   */
  const [targetHorizontalTilt, setTargetHorizontalTilt] = useState(() => tilt ? loadControl(initialService, 'TargetHorizontalTiltAngle', 1) : undefined)
  const [targetVerticalTilt, setTargetVerticalTilt] = useState(() => tilt ? loadControl(initialService, 'TargetVerticalTiltAngle', 1) : undefined)

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => {
      if (targetPosition) {
        m.applySliderGradient('linear-gradient(to right, #242424, #ffd6aa)')
      }
    },
    onUpdate: (service) => {
      if (!guardUpdate || 'TargetPosition' in service.values) {
        setTargetPosition(prev => prev && { ...prev, value: service.getCharacteristic!('TargetPosition')?.value as number })
      }
      if ('TargetHorizontalTiltAngle' in service.values) {
        setTargetHorizontalTilt(prev => prev && { ...prev, value: service.getCharacteristic!('TargetHorizontalTiltAngle').value as number })
      }
      if ('TargetVerticalTiltAngle' in service.values) {
        setTargetVerticalTilt(prev => prev && { ...prev, value: service.getCharacteristic!('TargetVerticalTiltAngle').value as number })
      }
    },
  })
  const live = useLatest(m.service)

  const onTargetPositionChange = (value: number) => {
    setTargetPosition(prev => prev && { ...prev, value })
    m.debounce('position', value, (position) => {
      const service = live.current
      // The accessory reports PositionState itself, but not until it starts
      // moving - without this the tile shows nothing happening
      if ((service.getCharacteristic!('CurrentPosition')!.value as number) < position) {
        service.values.PositionState = 1
      } else if ((service.getCharacteristic!('CurrentPosition')!.value as number) > position) {
        service.values.PositionState = 0
      }
      void service.getCharacteristic!('TargetPosition').setValue!(position)
      rerender()
    })
  }

  const onTiltChange = (name: 'TargetHorizontalTiltAngle' | 'TargetVerticalTiltAngle', value: number) => {
    const set = name === 'TargetHorizontalTiltAngle' ? setTargetHorizontalTilt : setTargetVerticalTilt
    set(prev => prev && { ...prev, value })
    m.debounce(name, value, angle => void live.current.getCharacteristic!(name)?.setValue!(angle))
  }

  const service = m.service
  const currentPosition = service.getCharacteristic!('CurrentPosition')?.value as number
  const hidden = a11y ? { 'aria-hidden': true as const } : {}
  const status = a11y ? { 'role': 'status', 'aria-live': 'polite' as const, 'aria-atomic': true } : {}
  const scale = (
    <div className="d-flex justify-content-between align-items-center mt-0 mb-1" {...hidden}>
      <span className="grey-text small">{t('accessories.control.closed')}</span>
      <span className="grey-text small">{t('accessories.control.open')}</span>
    </div>
  )

  let state = null
  if (service.values?.PositionState === 2) {
    state = service.values?.CurrentPosition === 0
      ? t('accessories.control.closed')
      : `${t('accessories.control.open')} ${currentPosition}%`
  } else if (service.values?.PositionState === 1) {
    state = `${t('accessories.control.opening')}...`
  } else if (service.values?.PositionState === 0) {
    state = `${t('accessories.control.closing')}...`
  }

  const tiltSliders = (
    control: PositionControl | undefined,
    name: 'TargetHorizontalTiltAngle' | 'TargetVerticalTiltAngle',
    targetKey: string,
    currentKey: string,
    current: number,
  ) => control && (
    <>
      <h6 className="mt-4">
        {t(targetKey)}
        {': '}
        {control.value}
        °
      </h6>
      <Slider
        className="mb-1"
        min={control.min}
        max={control.max}
        step={control.step}
        value={control.value}
        onChange={value => onTiltChange(name, value as number)}
      />
      <h6 className="mt-4">
        {t(currentKey)}
        {': '}
        {current}
        °
      </h6>
      <Slider className="mb-1" min={control.min} max={control.max} step={control.step} disabled value={current} />
    </>
  )

  return (
    <ManageModal title={service.customName || service.serviceName} onClose={m.dismissModal}>
      <div className="modal-body text-center px-5">
        <div className="d-flex justify-content-center mb-0 p-0">
          <div className="mb-0 mx-0 p-3 btn-read w-100" {...status}>
            {state}
          </div>
        </div>
        {targetPosition && (
          <>
            <h6 className="mt-4" {...hidden}>
              {t('accessories.control.target')}
              {': '}
              {targetPosition.value}
              %
            </h6>
            <Slider
              className="mb-1"
              min={targetPosition.min}
              max={targetPosition.max}
              step={targetPosition.step}
              value={targetPosition.value}
              onChange={value => onTargetPositionChange(value as number)}
            />
          </>
        )}
        {scale}
        <h6 className="mt-4" {...hidden}>
          {t('accessories.control.current')}
          {': '}
          {currentPosition}
          %
        </h6>
        <Slider className="mb-1" min={0} max={100} step={1} disabled value={currentPosition} />
        {scale}
        {tiltSliders(
          targetHorizontalTilt,
          'TargetHorizontalTiltAngle',
          'accessories.control.tilt_horizontal_target',
          'accessories.control.tilt_horizontal_current',
          service.getCharacteristic!('CurrentHorizontalTiltAngle')?.value as number,
        )}
        {tiltSliders(
          targetVerticalTilt,
          'TargetVerticalTiltAngle',
          'accessories.control.tilt_vertical_target',
          'accessories.control.tilt_vertical_current',
          service.getCharacteristic!('CurrentVerticalTiltAngle')?.value as number,
        )}
      </div>
    </ManageModal>
  )
}
