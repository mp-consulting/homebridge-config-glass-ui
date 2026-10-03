import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'
import type { MouseEvent } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ThermostatSystemMode } from '@/core/accessories/types/matter/matter-device.constants'
import {
  getThermostatCoolingSetpoint,
  getThermostatHeatingSetpoint,
  getThermostatLocalTemperature,
  getThermostatSupportedModes,
  getThermostatSystemMode,
  setThermostatCoolingSetpoint,
  setThermostatHeatingSetpoint,
  setThermostatSystemMode,
} from '@/core/accessories/types/matter/matter-device.utils'
import { MatterManageModal, ModeButton } from '@/core/accessories/types/matter/matter-manage'
import { useStateRef } from '@/core/accessories/types/matter/use-state-ref'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'
import { convertTemp } from '@/core/pipes/convert-temp'
import { formatDecimal } from '@/core/pipes/decimal'
import { useSettingsStore } from '@/core/settings/settings.store'

const GRADIENT = 'linear-gradient(to right, rgb(80, 80, 179), rgb(173, 216, 230), rgb(255, 185, 120), rgb(139, 90, 60))'

function statusClass(targetMode: number): string {
  if (targetMode === ThermostatSystemMode.Cool) {
    return 'status-color-cooling'
  }

  if (targetMode === ThermostatSystemMode.Heat) {
    return 'status-color-heating'
  }

  if (targetMode === ThermostatSystemMode.Auto) {
    return 'status-color-active'
  }

  return 'status-color-inactive'
}

/**
 * The setpoint limits, in celsius, from the cluster if it has them.
 * @param service - the accessory service
 */
function setpointLimits(service: ServiceTypeX) {
  // Temperature range limits (in Celsius, will be converted if needed)
  const limits = { minHeatSetpoint: 7, maxHeatSetpoint: 30, minCoolSetpoint: 10, maxCoolSetpoint: 35 }
  const cluster = service.clusters?.thermostat
  if (cluster) {
    // A limit of 0 (0°C) is legitimate, so only fall back when the attribute is absent
    limits.minHeatSetpoint = cluster.minHeatSetpointLimit != null ? cluster.minHeatSetpointLimit / 100 : 7
    limits.maxHeatSetpoint = cluster.maxHeatSetpointLimit != null ? cluster.maxHeatSetpointLimit / 100 : 30
    limits.minCoolSetpoint = cluster.minCoolSetpointLimit != null ? cluster.minCoolSetpointLimit / 100 : 10
    limits.maxCoolSetpoint = cluster.maxCoolSetpointLimit != null ? cluster.maxCoolSetpointLimit / 100 : 35
  }
  return limits
}

/** The Matter thermostat modal (Angular `MatterThermostatManageComponent`). */
export function MatterThermostatManage({ service: initial, activeModal }: AccessoryManageModalProps) {
  const { t } = useTranslation()
  const temperatureUnits = useSettingsStore(state => state.env.temperatureUnits)
  const serviceRef = useRef<ServiceTypeX>(initial)

  // Only offer the modes the device actually has - a thermostat without the
  // AutoMode feature must not show an Auto button (the write would be rejected)
  const [supportedModes] = useState(() => getThermostatSupportedModes(initial))
  const [limits] = useState(() => setpointLimits(initial))
  const [targetMode, setTargetModeState, targetModeRef] = useStateRef(() => getThermostatSystemMode(initial))
  const [targetHeatingTemp, setTargetHeatingTemp, heatingRef] = useStateRef(() => getThermostatHeatingSetpoint(initial))
  const [targetCoolingTemp, setTargetCoolingTemp, coolingRef] = useStateRef(() => getThermostatCoolingSetpoint(initial))
  const [autoTemp, setAutoTemp, autoTempRef] = useStateRef<[number, number]>(() => [heatingRef.current, coolingRef.current])

  const applyGradientRef = useRef<(gradient: string) => void>(() => {})

  const manage = useManageAccessory(initial, {
    activeModal,
    onUpdate: (service) => {
      serviceRef.current = service
      const previousMode = targetModeRef.current
      setTargetModeState(getThermostatSystemMode(service))
      setTargetHeatingTemp(getThermostatHeatingSetpoint(service))
      setTargetCoolingTemp(getThermostatCoolingSetpoint(service))
      setAutoTemp([heatingRef.current, coolingRef.current])

      // Only re-apply gradient when mode changes (new slider is created)
      if (previousMode !== targetModeRef.current) {
        applyGradientRef.current(GRADIENT)
      }
    },
  })
  const { service, applySliderGradient, debounce, showGenericErrorToast, blurTarget } = manage
  applyGradientRef.current = applySliderGradient

  useEffect(() => {
    applySliderGradient(GRADIENT)
  }, [applySliderGradient])

  const onHeatingTempChange = (value: number) => {
    setTargetHeatingTemp(value)
    debounce('heating', value, async () => {
      try {
        await setThermostatHeatingSetpoint(serviceRef.current, heatingRef.current)
      } catch (error) {
        showGenericErrorToast(error)
        // Revert to current value on error
        setTargetHeatingTemp(getThermostatHeatingSetpoint(serviceRef.current))
      }
    })
  }

  const onCoolingTempChange = (value: number) => {
    setTargetCoolingTemp(value)
    debounce('cooling', value, async () => {
      try {
        await setThermostatCoolingSetpoint(serviceRef.current, coolingRef.current)
      } catch (error) {
        showGenericErrorToast(error)
        // Revert to current value on error
        setTargetCoolingTemp(getThermostatCoolingSetpoint(serviceRef.current))
      }
    })
  }

  const onAutoTempChange = (value: [number, number]) => {
    setAutoTemp(value)
    setTargetHeatingTemp(value[0])
    setTargetCoolingTemp(value[1])
    debounce('auto', value, async () => {
      try {
        await setThermostatHeatingSetpoint(serviceRef.current, autoTempRef.current[0])
        await setThermostatCoolingSetpoint(serviceRef.current, autoTempRef.current[1])
      } catch (error) {
        showGenericErrorToast(error)
        // Revert to current values on error
        setTargetHeatingTemp(getThermostatHeatingSetpoint(serviceRef.current))
        setTargetCoolingTemp(getThermostatCoolingSetpoint(serviceRef.current))
        setAutoTemp([heatingRef.current, coolingRef.current])
      }
    })
  }

  const setTargetMode = async (value: number, event: MouseEvent) => {
    const previousMode = targetModeRef.current

    try {
      setTargetModeState(value)

      await setThermostatSystemMode(serviceRef.current, value)

      blurTarget(event)

      // Apply gradient to the new slider after it's created
      applySliderGradient(GRADIENT)
    } catch (error) {
      showGenericErrorToast(error)
      // Revert to previous mode on error
      setTargetModeState(previousMode)
    }
  }

  if (!manage.ready) {
    return null
  }

  const currentTemperature = getThermostatLocalTemperature(service)
  const units = (temperatureUnits ?? '').toUpperCase()
  const temp = (value: number) => formatDecimal(convertTemp(value), '1.0-1')

  return (
    <MatterManageModal service={service} onDismiss={manage.dismissModal}>
      <div className="modal-body text-center px-5">
        {currentTemperature !== null && (
          <h6 className="mt-2 mb-4 fs-4">
            <i className={`fas fa-temperature-full ${statusClass(targetMode)}`}></i>
            {temp(currentTemperature)}
            °
            {units}
          </h6>
        )}
        <div
          className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
          role="group"
          aria-label={t('accessories.control.mode_control')}
        >
          <ModeButton selected={targetMode === 0} onClick={event => void setTargetMode(0, event)}>
            {t('accessories.control.off')}
          </ModeButton>
          {supportedModes.auto && (
            <ModeButton selected={targetMode === 1} onClick={event => void setTargetMode(1, event)}>
              {t('accessories.control.auto')}
            </ModeButton>
          )}
          {supportedModes.heat && (
            <ModeButton selected={targetMode === 4} onClick={event => void setTargetMode(4, event)}>
              {t('accessories.control.heat')}
            </ModeButton>
          )}
          {supportedModes.cool && (
            <ModeButton selected={targetMode === 3} onClick={event => void setTargetMode(3, event)}>
              {t('accessories.control.cool')}
            </ModeButton>
          )}
        </div>

        {/* Auto mode - both heating and cooling */}
        {targetMode === 1 && (
          <>
            <h6 className="mt-4 mb-1">
              {t('accessories.control.threshold_auto')}
              :
              {' '}
              {temp(autoTemp[0])}
              &deg;
              {units}
              {' '}
              -
              {' '}
              {temp(autoTemp[1])}
              &deg;
              {units}
            </h6>
            <Slider
              key="auto"
              min={limits.minHeatSetpoint}
              max={limits.maxCoolSetpoint}
              step={0.5}
              value={autoTemp}
              onChange={value => onAutoTempChange(value as [number, number])}
            />
          </>
        )}

        {/* Heat mode - only heating setpoint */}
        {targetMode === 4 && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.target')}
              :
              {' '}
              {temp(targetHeatingTemp)}
              &deg;
              {units}
            </h6>
            <Slider
              key="heat"
              min={limits.minHeatSetpoint}
              max={limits.maxHeatSetpoint}
              step={0.5}
              value={targetHeatingTemp}
              onChange={value => onHeatingTempChange(value as number)}
            />
          </>
        )}

        {/* Cool mode - only cooling setpoint */}
        {targetMode === 3 && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.target')}
              :
              {' '}
              {temp(targetCoolingTemp)}
              &deg;
              {units}
            </h6>
            <Slider
              key="cool"
              min={limits.minCoolSetpoint}
              max={limits.maxCoolSetpoint}
              step={0.5}
              value={targetCoolingTemp}
              onChange={value => onCoolingTempChange(value as number)}
            />
          </>
        )}
      </div>
    </MatterManageModal>
  )
}
