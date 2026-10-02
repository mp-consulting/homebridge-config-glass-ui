import type { SliderControlConfig } from '@/core/accessories/accessories.interfaces'
import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatTemp, useTemperatureUnits } from '@/core/accessories/types/hap/hap-tile'
import { ManageHeader, ModeButton } from '@/core/accessories/types/hap/manage-parts'
import { thermostatStatusClass } from '@/core/accessories/types/hap/thermostat/thermostat.utils'
import { useLatest } from '@/core/accessories/types/hap/use-latest'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'

const THERMOSTAT_GRADIENT = 'linear-gradient(to right, rgb(80, 80, 179), rgb(173, 216, 230), rgb(255, 185, 120), rgb(139, 90, 60))'

export function ThermostatManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()
  const temperatureUnits = useTemperatureUnits()
  const unit = temperatureUnits.toUpperCase()

  // Read once, at setup
  const [chars] = useState(() => ({
    cooling: initialService.getCharacteristic!('CoolingThresholdTemperature'),
    heating: initialService.getCharacteristic!('HeatingThresholdTemperature'),
    validValues: (initialService.getCharacteristic!('TargetHeatingCoolingState')?.validValues as number[] | undefined) ?? [],
    hasHumidity: !!initialService.getCharacteristic!('CurrentRelativeHumidity'),
  }))
  const { cooling: CoolingThresholdTemperature, heating: HeatingThresholdTemperature, validValues: targetStateValidValues, hasHumidity } = chars

  const [targetMode, setTargetMode] = useState<number>(() => initialService.values.TargetHeatingCoolingState)
  const [targetTemperature, setTargetTemperature] = useState<SliderControlConfig | undefined>(() => {
    const TargetTemperature = initialService.getCharacteristic!('TargetTemperature')
    return TargetTemperature
      ? {
          value: TargetTemperature.value as number,
          min: TargetTemperature.minValue,
          max: TargetTemperature.maxValue,
          step: TargetTemperature.minStep || 0.5,
        }
      : undefined
  })
  const [targetCoolingTemp, setTargetCoolingTemp] = useState(() => CoolingThresholdTemperature?.value as number)
  const [targetHeatingTemp, setTargetHeatingTemp] = useState(() => HeatingThresholdTemperature?.value as number)
  const [autoTemp, setAutoTemp] = useState<[number, number]>(() => [targetHeatingTemp, targetCoolingTemp])

  const targetCoolingTempRef = useLatest(targetCoolingTemp)
  const targetHeatingTempRef = useLatest(targetHeatingTemp)

  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => m.applySliderGradient(THERMOSTAT_GRADIENT),
    onUpdate: (service) => {
      setTargetMode(service.values.TargetHeatingCoolingState)
      setTargetTemperature(prev => prev && { ...prev, value: service.getCharacteristic!('TargetTemperature').value as number })
      const cool = CoolingThresholdTemperature ? service.getCharacteristic!('CoolingThresholdTemperature').value as number : targetCoolingTempRef.current
      const heat = HeatingThresholdTemperature ? service.getCharacteristic!('HeatingThresholdTemperature').value as number : targetHeatingTempRef.current
      setTargetCoolingTemp(cool)
      setTargetHeatingTemp(heat)
      setAutoTemp([heat, cool])

      // Apply gradient when mode changes externally
      m.applySliderGradient(THERMOSTAT_GRADIENT)
    },
  })
  const live = useLatest(m.service)

  const writeThresholds = (heating: number, coolingTemp: number) => {
    m.debounce('threshold', [heating, coolingTemp] as const, ([heat, cool]) => {
      if (HeatingThresholdTemperature) {
        void live.current.getCharacteristic!('HeatingThresholdTemperature').setValue!(heat)
      }
      if (CoolingThresholdTemperature) {
        void live.current.getCharacteristic!('CoolingThresholdTemperature').setValue!(cool)
      }
    })
  }

  const onTargetMode = (value: number, event: MouseEvent) => {
    setTargetMode(value)
    void live.current.getCharacteristic!('TargetHeatingCoolingState').setValue!(value)
    m.blurTarget(event)

    // Apply gradient to the new slider after it's created
    m.applySliderGradient(THERMOSTAT_GRADIENT)
  }

  const onTemperatureStateChange = (value: number) => {
    setTargetTemperature(prev => prev && { ...prev, value })
    m.debounce('temperature', value, temperature => void live.current.getCharacteristic!('TargetTemperature').setValue!(temperature))
  }

  const onThresholdStateChange = (heating: number, coolingTemp: number) => {
    setTargetHeatingTemp(heating)
    setTargetCoolingTemp(coolingTemp)
    setAutoTemp([heating, coolingTemp])
    writeThresholds(heating, coolingTemp)
  }

  const onAutoThresholdStateChange = (value: number[]) => {
    const [heating, coolingTemp] = value
    setAutoTemp([heating, coolingTemp])
    setTargetHeatingTemp(heating)
    setTargetCoolingTemp(coolingTemp)
    writeThresholds(heating, coolingTemp)
  }

  const service = m.service
  const temp = (value: number | undefined) => `${formatTemp(value, temperatureUnits)}°${unit}`

  const modes: Array<[number, string]> = [
    [0, 'accessories.control.off'],
    [3, 'accessories.control.auto'],
    [1, 'accessories.control.heat'],
    [2, 'accessories.control.cool'],
  ]

  return (
    <div className="modal-content">
      <ManageHeader title={service.customName || service.serviceName} onClose={m.dismissModal} />
      <div className="modal-body text-center px-5">
        <h6 className="mt-2 mb-4 fs-4">
          <i className={`fas fa-temperature-full ${thermostatStatusClass(service)}`}></i>
          {temp(service.values?.CurrentTemperature)}
          {hasHumidity && ` · ${service.values?.CurrentRelativeHumidity}%`}
        </h6>
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
        {'TargetTemperature' in service.values && targetTemperature && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.target')}
              {': '}
              {temp(targetTemperature.value)}
            </h6>
            <Slider
              min={targetTemperature.min!}
              max={targetTemperature.max!}
              step={targetTemperature.step!}
              value={targetTemperature.value}
              onChange={value => onTemperatureStateChange(value as number)}
            />
          </>
        )}
        {targetStateValidValues.includes(3) && (
          HeatingThresholdTemperature && CoolingThresholdTemperature
            ? (
                <>
                  <h6 className="mt-4 mb-1">
                    {t('accessories.control.threshold_auto')}
                    {': '}
                    {`${temp(autoTemp[0])} - ${temp(autoTemp[1])}`}
                  </h6>
                  <Slider
                    min={HeatingThresholdTemperature.minValue!}
                    max={CoolingThresholdTemperature.maxValue!}
                    step={CoolingThresholdTemperature.minStep!}
                    value={autoTemp}
                    onChange={value => onAutoThresholdStateChange(value as number[])}
                  />
                </>
              )
            : HeatingThresholdTemperature
              ? (
                  <>
                    <h6 className="mt-4">
                      {t('accessories.control.threshold_auto')}
                      {': '}
                      {temp(targetHeatingTemp)}
                    </h6>
                    <Slider
                      min={HeatingThresholdTemperature.minValue!}
                      max={HeatingThresholdTemperature.maxValue!}
                      step={HeatingThresholdTemperature.minStep!}
                      value={targetHeatingTemp}
                      onChange={value => onThresholdStateChange(value as number, targetCoolingTemp)}
                    />
                  </>
                )
              : CoolingThresholdTemperature && (
                <>
                  <h6 className="mt-4">
                    {t('accessories.control.threshold_auto')}
                    {': '}
                    {temp(targetCoolingTemp)}
                  </h6>
                  <Slider
                    min={CoolingThresholdTemperature.minValue!}
                    max={CoolingThresholdTemperature.maxValue!}
                    step={CoolingThresholdTemperature.minStep!}
                    value={targetCoolingTemp}
                    onChange={value => onThresholdStateChange(targetHeatingTemp, value as number)}
                  />
                </>
              )
        )}
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
