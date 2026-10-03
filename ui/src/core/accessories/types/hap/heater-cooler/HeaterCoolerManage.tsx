import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { HeaterCoolerType } from '@/core/accessories/types/hap/heater-cooler/heater-cooler.utils'
import type { MouseEvent } from 'react'

import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatTemp, useTemperatureUnits } from '@/core/accessories/types/hap/hap-tile'
import { heaterCoolerFanGradient, heaterCoolerStatusClass, linkedFan, loadRotationSpeed } from '@/core/accessories/types/hap/heater-cooler/heater-cooler.utils'
import { ManageHeader, ModeButton } from '@/core/accessories/types/hap/manage-parts'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'
import { useLatest } from '@/core/hooks/use-latest'

const TEMP_GRADIENT = 'linear-gradient(to right, rgb(80, 80, 179), rgb(173, 216, 230), rgb(255, 185, 120), rgb(139, 90, 60))'

function readTemps(service: ServiceTypeX) {
  const cooling = service.getCharacteristic!('CoolingThresholdTemperature')?.value as number
  const heating = service.getCharacteristic!('HeatingThresholdTemperature')?.value as number
  return { cooling, heating }
}

export function HeaterCoolerManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()
  const temperatureUnits = useTemperatureUnits()
  const unit = temperatureUnits.toUpperCase()

  const [setup] = useState(() => {
    const targetStateValidValues = (initialService.getCharacteristic!('TargetHeaterCoolerState')?.validValues as number[] | undefined) ?? []
    // Derive type from valid target states: heat-only, cool-only, or dual
    let type: HeaterCoolerType
    if (targetStateValidValues.includes(1) && !targetStateValidValues.includes(2)) {
      type = 'heater'
    } else if (targetStateValidValues.includes(2) && !targetStateValidValues.includes(1)) {
      type = 'cooler'
    }
    return {
      type,
      targetStateValidValues,
      CoolingThresholdTemperature: initialService.getCharacteristic!('CoolingThresholdTemperature'),
      HeatingThresholdTemperature: initialService.getCharacteristic!('HeatingThresholdTemperature'),
      // Check for a linked Fan/Fanv2 service (combined from same physical device)
      serviceFan: linkedFan(initialService),
    }
  })
  const { type, targetStateValidValues, CoolingThresholdTemperature, HeatingThresholdTemperature, serviceFan } = setup

  const [targetState, setTargetState] = useState<number>(() => initialService.values.Active)
  const [targetMode, setTargetMode] = useState<number>(() => initialService.values.TargetHeaterCoolerState)
  const [temps, setTemps] = useState(() => readTemps(initialService))
  const [targetRotationSpeed, setTargetRotationSpeed] = useState(() => loadRotationSpeed(serviceFan))
  const targetHeatingTemp = temps.heating
  const targetCoolingTemp = temps.cooling
  const autoTemp: [number, number] = [targetHeatingTemp, targetCoolingTemp]

  const gradients = (state: number, mode: number): Array<[string, string]> => [
    [TEMP_GRADIENT, '.temp-slider .noUi-target'],
    ...(serviceFan ? [[heaterCoolerFanGradient(state, mode), '.fan-slider .noUi-target'] as [string, string]] : []),
  ]

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => gradients(targetState, targetMode).forEach(([g, sel]) => m.applySliderGradient(g, sel)),
    onUpdate: (service) => {
      setTargetState(service.values.Active)
      setTargetMode(service.values.TargetHeaterCoolerState)
      setTemps(readTemps(service))
      if (serviceFan) {
        setTargetRotationSpeed(prev => prev && { ...prev, value: serviceFan.getCharacteristic!('RotationSpeed')?.value as number })
      }

      // Apply gradient when mode changes externally
      gradients(service.values.Active, service.values.TargetHeaterCoolerState).forEach(([g, sel]) => m.applySliderGradient(g, sel))
    },
  })
  const live = useLatest(m.service)
  const applyAllGradients = (state: number, mode: number) => gradients(state, mode).forEach(([g, sel]) => m.applySliderGradient(g, sel))

  const writeTemps = (next: { heating: number, cooling: number }) => {
    m.debounce('temperature', next, ({ heating, cooling }) => {
      if (HeatingThresholdTemperature) {
        void live.current.getCharacteristic!('HeatingThresholdTemperature').setValue!(heating)
      }
      if (CoolingThresholdTemperature) {
        void live.current.getCharacteristic!('CoolingThresholdTemperature').setValue!(cooling)
      }
    })
  }

  const onTargetState = (value: number, event: MouseEvent) => {
    setTargetState(value)
    void live.current.getCharacteristic!('Active').setValue!(value)
    setTemps(readTemps(live.current))
    applyAllGradients(value, targetMode)
    m.blurTarget(event)
  }

  const onTargetMode = (value: number, event: MouseEvent) => {
    setTargetMode(value)
    void live.current.getCharacteristic!('TargetHeaterCoolerState').setValue!(value)
    setTemps(readTemps(live.current))
    m.blurTarget(event)

    // Apply gradient to the new slider after it's created
    applyAllGradients(targetState, value)
  }

  const onTemperatureStateChange = (next: { heating: number, cooling: number }) => {
    setTemps(next)
    writeTemps(next)
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
  const temp = (value: number | undefined) => `${formatTemp(value, temperatureUnits)}°${unit}`

  const modes: Array<[number, string]> = [
    [0, 'accessories.control.auto'],
    [1, 'accessories.control.heat'],
    [2, 'accessories.control.cool'],
  ]

  let tempControl = null
  if (targetStateValidValues.includes(0)) {
    if (targetMode === 0 && HeatingThresholdTemperature && CoolingThresholdTemperature) {
      tempControl = (
        <Fragment key="auto">
          <h6 className="mt-4 mb-1">
            {t('accessories.control.temperature_thresholds')}
            {': '}
            {`${temp(autoTemp[0])} - ${temp(autoTemp[1])}`}
          </h6>
          <div className="temp-slider">
            <Slider
              min={HeatingThresholdTemperature.minValue!}
              max={CoolingThresholdTemperature.maxValue!}
              step={CoolingThresholdTemperature.minStep!}
              value={autoTemp}
              onChange={(value) => {
                const [heating, cooling] = value as number[]
                onTemperatureStateChange({ heating, cooling })
              }}
            />
          </div>
        </Fragment>
      )
    } else if (HeatingThresholdTemperature && (targetMode === 1 || (targetMode === 0 && !CoolingThresholdTemperature))) {
      tempControl = (
        <Fragment key="heat">
          <h6 className="mt-4">
            {t('accessories.control.heating_threshold')}
            {': '}
            {temp(targetHeatingTemp)}
          </h6>
          <div className="temp-slider">
            <Slider
              min={HeatingThresholdTemperature.minValue!}
              max={HeatingThresholdTemperature.maxValue!}
              step={HeatingThresholdTemperature.minStep!}
              value={targetHeatingTemp}
              onChange={value => onTemperatureStateChange({ heating: value as number, cooling: targetCoolingTemp })}
            />
          </div>
        </Fragment>
      )
    } else if (CoolingThresholdTemperature && (targetMode === 2 || (targetMode === 0 && !HeatingThresholdTemperature))) {
      tempControl = (
        <Fragment key="cool">
          <h6 className="mt-4">
            {t('accessories.control.cooling_threshold')}
            {': '}
            {temp(targetCoolingTemp)}
          </h6>
          <div className="temp-slider">
            <Slider
              min={CoolingThresholdTemperature.minValue!}
              max={CoolingThresholdTemperature.maxValue!}
              step={CoolingThresholdTemperature.minStep!}
              value={targetCoolingTemp}
              onChange={value => onTemperatureStateChange({ heating: targetHeatingTemp, cooling: value as number })}
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
          <i className={`fas fa-temperature-full ${heaterCoolerStatusClass(service, type)}`}></i>
          {temp(service.values?.CurrentTemperature)}
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
        {tempControl}

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
