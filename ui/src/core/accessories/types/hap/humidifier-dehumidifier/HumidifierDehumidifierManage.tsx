import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { HumidifierType } from '@/core/accessories/types/hap/humidifier-dehumidifier/humidifier-dehumidifier.utils'
import type { MouseEvent } from 'react'

import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { linkedFan, loadRotationSpeed } from '@/core/accessories/types/hap/heater-cooler/heater-cooler.utils'
import { humidifierFanGradient, humidifierStatusClass } from '@/core/accessories/types/hap/humidifier-dehumidifier/humidifier-dehumidifier.utils'
import { ManageHeader, ModeButton } from '@/core/accessories/types/hap/manage-parts'
import { useLatest } from '@/core/accessories/types/hap/use-latest'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'

const HUMIDITY_GRADIENT = 'linear-gradient(to left, rgb(80, 80, 179), rgb(173, 216, 230), rgb(255, 185, 120), rgb(139, 90, 60))'

function readHumidity(service: ServiceTypeX) {
  const dehumidify = service.getCharacteristic!('RelativeHumidityDehumidifierThreshold')?.value as number
  const humidify = service.getCharacteristic!('RelativeHumidityHumidifierThreshold')?.value as number
  return { dehumidify, humidify }
}

export function HumidifierDehumidifierManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()

  const [setup] = useState(() => {
    const targetStateValidValues = (initialService.getCharacteristic!('TargetHumidifierDehumidifierState')?.validValues as number[] | undefined) ?? []
    // Derive type from valid target states: humidify-only, dehumidify-only, or dual
    let type: HumidifierType
    if (targetStateValidValues.includes(1) && !targetStateValidValues.includes(2)) {
      type = 'humidifier'
    } else if (targetStateValidValues.includes(2) && !targetStateValidValues.includes(1)) {
      type = 'dehumidifier'
    }
    return {
      type,
      targetStateValidValues,
      RelativeHumidityDehumidifierThreshold: initialService.getCharacteristic!('RelativeHumidityDehumidifierThreshold'),
      RelativeHumidityHumidifierThreshold: initialService.getCharacteristic!('RelativeHumidityHumidifierThreshold'),
      // Check for a linked Fan/Fanv2 service (combined from same physical device)
      serviceFan: linkedFan(initialService),
    }
  })
  const { type, targetStateValidValues, RelativeHumidityDehumidifierThreshold, RelativeHumidityHumidifierThreshold, serviceFan } = setup

  const [targetState, setTargetState] = useState<number>(() => initialService.values.Active)
  const [targetMode, setTargetMode] = useState<number>(() => initialService.values.TargetHumidifierDehumidifierState)
  const [humidity, setHumidity] = useState(() => readHumidity(initialService))
  const [targetRotationSpeed, setTargetRotationSpeed] = useState(() => loadRotationSpeed(serviceFan))
  const targetHumidifierHumidity = humidity.humidify
  const targetDehumidifierHumidity = humidity.dehumidify
  const autoHumidity: [number, number] = [targetHumidifierHumidity, targetDehumidifierHumidity]

  const gradients = (state: number, mode: number): Array<[string, string]> => [
    [HUMIDITY_GRADIENT, '.humidity-slider .noUi-target'],
    ...(serviceFan ? [[humidifierFanGradient(state, mode), '.fan-slider .noUi-target'] as [string, string]] : []),
  ]

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => gradients(targetState, targetMode).forEach(([g, sel]) => m.applySliderGradient(g, sel)),
    onUpdate: (service) => {
      setTargetState(service.values.Active)
      setTargetMode(service.values.TargetHumidifierDehumidifierState)
      setHumidity(readHumidity(service))
      if (serviceFan) {
        setTargetRotationSpeed(prev => prev && { ...prev, value: serviceFan.getCharacteristic!('RotationSpeed')?.value as number })
      }

      // Apply gradient when mode changes externally
      gradients(service.values.Active, service.values.TargetHumidifierDehumidifierState).forEach(([g, sel]) => m.applySliderGradient(g, sel))
    },
  })
  const live = useLatest(m.service)
  const applyAllGradients = (state: number, mode: number) => gradients(state, mode).forEach(([g, sel]) => m.applySliderGradient(g, sel))

  const writeHumidity = (next: { humidify: number, dehumidify: number }) => {
    m.debounce('humidity', next, ({ humidify, dehumidify }) => {
      if (RelativeHumidityHumidifierThreshold) {
        void live.current.getCharacteristic!('RelativeHumidityHumidifierThreshold').setValue!(humidify)
      }
      if (RelativeHumidityDehumidifierThreshold) {
        void live.current.getCharacteristic!('RelativeHumidityDehumidifierThreshold').setValue!(dehumidify)
      }
    })
  }

  const onTargetState = (value: number, event: MouseEvent) => {
    setTargetState(value)
    void live.current.getCharacteristic!('Active').setValue!(value)
    setHumidity(readHumidity(live.current))
    applyAllGradients(value, targetMode)
    m.blurTarget(event)
  }

  const onTargetMode = (value: number, event: MouseEvent) => {
    setTargetMode(value)
    void live.current.getCharacteristic!('TargetHumidifierDehumidifierState').setValue!(value)
    setHumidity(readHumidity(live.current))
    m.blurTarget(event)

    // Apply gradient to the new slider after it's created
    applyAllGradients(targetState, value)
  }

  const onHumidityStateChange = (next: { humidify: number, dehumidify: number }) => {
    setHumidity(next)
    writeHumidity(next)
  }

  const onTargetRotationSpeedChange = (value: number) => {
    setTargetRotationSpeed(prev => prev && { ...prev, value })
    m.debounce('rotationSpeed', value, (speed) => {
      if (serviceFan) {
        void serviceFan.getCharacteristic!('RotationSpeed').setValue!(speed)
      }
    })
  }

  const service = m.service
  const pct = (value: number | undefined) => `${value}%`

  const modes: Array<[number, string]> = [
    [0, 'accessories.control.auto'],
    [1, 'accessories.control.humidify'],
    [2, 'accessories.control.dehumidify'],
  ]

  let humidityControl = null
  if (targetStateValidValues.includes(0)) {
    if (targetMode === 0 && RelativeHumidityHumidifierThreshold && RelativeHumidityDehumidifierThreshold) {
      humidityControl = (
        <Fragment key="auto">
          <h6 className="mt-4">
            {t('accessories.control.humidity_thresholds')}
            {': '}
            {`${pct(autoHumidity[0])} - ${pct(autoHumidity[1])}`}
          </h6>
          <div className="humidity-slider">
            <Slider
              min={RelativeHumidityHumidifierThreshold.minValue!}
              max={RelativeHumidityDehumidifierThreshold.maxValue!}
              step={RelativeHumidityDehumidifierThreshold.minStep!}
              value={autoHumidity}
              onChange={(value) => {
                const [humidify, dehumidify] = value as number[]
                onHumidityStateChange({ humidify, dehumidify })
              }}
            />
          </div>
        </Fragment>
      )
    } else if (RelativeHumidityHumidifierThreshold && (targetMode === 1 || (targetMode === 0 && !RelativeHumidityDehumidifierThreshold))) {
      humidityControl = (
        <Fragment key="humidify">
          <h6 className="mt-4">
            {t('accessories.control.humidifier_threshold')}
            {': '}
            {pct(targetHumidifierHumidity)}
          </h6>
          <div className="humidity-slider">
            <Slider
              min={RelativeHumidityHumidifierThreshold.minValue!}
              max={RelativeHumidityHumidifierThreshold.maxValue!}
              step={RelativeHumidityHumidifierThreshold.minStep!}
              value={targetHumidifierHumidity}
              onChange={value => onHumidityStateChange({ humidify: value as number, dehumidify: targetDehumidifierHumidity })}
            />
          </div>
        </Fragment>
      )
    } else if (RelativeHumidityDehumidifierThreshold && (targetMode === 2 || (targetMode === 0 && !RelativeHumidityHumidifierThreshold))) {
      humidityControl = (
        <Fragment key="dehumidify">
          <h6 className="mt-4">
            {t('accessories.control.dehumidifier_threshold')}
            {': '}
            {pct(targetDehumidifierHumidity)}
          </h6>
          <div className="humidity-slider">
            <Slider
              min={RelativeHumidityDehumidifierThreshold.minValue!}
              max={RelativeHumidityDehumidifierThreshold.maxValue!}
              step={RelativeHumidityDehumidifierThreshold.minStep!}
              value={targetDehumidifierHumidity}
              onChange={value => onHumidityStateChange({ humidify: targetHumidifierHumidity, dehumidify: value as number })}
            />
          </div>
        </Fragment>
      )
    }
  }

  return (
    <div className="modal-content">
      <ManageHeader title={service.customName || service.serviceName} onClose={m.dismissModal} />
      <div className="modal-body text-center px-5">
        <h6 className="mt-2 mb-4 fs-4">
          <i className={`fas fa-temperature-full ${humidifierStatusClass(service, type)}`}></i>
          {pct(service.values?.CurrentRelativeHumidity)}
        </h6>
        <div
          className="btn-group-vertical d-flex justify-content-center mb-4 p-0"
          role="group"
          aria-label={t('accessories.control.state_control')}
        >
          <ModeButton selected={targetState === 0} onClick={event => onTargetState(0, event)}>{t('accessories.control.off')}</ModeButton>
          <ModeButton selected={targetState === 1} onClick={event => onTargetState(1, event)}>{t('accessories.control.on')}</ModeButton>
        </div>
        {!!targetStateValidValues.length && (
          <>
            <h6 className="mt-4">{t('accessories.control.mode')}</h6>
            <div
              className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
              role="group"
              aria-label={t('accessories.control.mode_control')}
            >
              {modes.filter(([mode]) => targetStateValidValues.includes(mode)).map(([mode, label]) => (
                <ModeButton key={mode} selected={targetMode === mode} onClick={event => onTargetMode(mode, event)}>
                  {t(label)}
                </ModeButton>
              ))}
            </div>
          </>
        )}
        {humidityControl}

        {targetRotationSpeed && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.rotation_speed')}
              {': '}
              {targetRotationSpeed.value}
              {targetRotationSpeed.unit === 'percentage' && '%'}
            </h6>
            <div className="fan-slider">
              <Slider
                min={targetRotationSpeed.min!}
                max={targetRotationSpeed.max!}
                step={targetRotationSpeed.step}
                value={targetRotationSpeed.value}
                onChange={value => onTargetRotationSpeedChange(value as number)}
              />
            </div>
          </>
        )}
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
