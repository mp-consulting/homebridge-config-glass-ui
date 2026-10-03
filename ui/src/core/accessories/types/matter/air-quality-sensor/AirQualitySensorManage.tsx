import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'

import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'

import { AIR_QUALITY_LABELS } from '@/core/accessories/types/matter/air-quality-sensor/air-quality-sensor'
import {
  getAirQualityValue,
  getCarbonMonoxideValue,
  getConcentrationUnit,
  getNitrogenDioxideValue,
  getOzoneValue,
  getPm10Value,
  getPm25Value,
  hasConcentrationData,
} from '@/core/accessories/types/matter/matter-device.utils'
import { MatterManageHeader } from '@/core/accessories/types/matter/matter-manage'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { cx } from '@/core/utilities/cx'

/** The Matter air quality modal (Angular `AirQualitySensorManageComponent`): read only. */
export function AirQualitySensorManage({ service: initial, activeModal }: AccessoryManageModalProps) {
  const { t } = useTranslation()
  // Everything here is read from the service, so a live update only has to
  // re-render (it may arrive as the same object, changed in place)
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const manage = useManageAccessory(initial, { activeModal, onUpdate: () => rerender() })
  const { service } = manage

  if (!manage.ready) {
    return null
  }

  const airQuality = getAirQualityValue(service)
  const pm25 = getPm25Value(service)
  const pm10 = getPm10Value(service)
  const co = getCarbonMonoxideValue(service)
  const no2 = getNitrogenDioxideValue(service)
  const ozone = getOzoneValue(service)

  const rows = [
    { key: 'accessories.control.pm25', value: pm25, cluster: 'pm25ConcentrationMeasurement' },
    { key: 'accessories.control.pm10', value: pm10, cluster: 'pm10ConcentrationMeasurement' },
    { key: 'accessories.control.carbon_monoxide', value: co, cluster: 'carbonMonoxideConcentrationMeasurement' },
    { key: 'accessories.control.nitrogen_dioxide', value: no2, cluster: 'nitrogenDioxideConcentrationMeasurement' },
    { key: 'accessories.control.ozone', value: ozone, cluster: 'ozoneConcentrationMeasurement' },
  ] as const

  return (
    <div className="modal-content">
      <MatterManageHeader service={service} onDismiss={manage.dismissModal} />
      <div className="modal-body px-4">
        <div className="text-center mb-3">
          <span
            className={cx(
              'badge rounded-pill fs-6',
              [1, 2].includes(airQuality) && 'bg-success',
              [3, 4].includes(airQuality) && 'bg-warning',
              airQuality >= 5 && 'bg-danger',
            )}
          >
            {t(AIR_QUALITY_LABELS[airQuality || 0])}
          </span>
        </div>
        {hasConcentrationData(service) && (
          <ul className="list-group list-group-box mb-0">
            {rows.map(row => row.value !== null && (
              <li key={row.key} className="list-group-item d-flex justify-content-between align-items-center">
                <span>{t(row.key)}</span>
                <span className="grey-text">
                  {row.value}
                  {' '}
                  {getConcentrationUnit(service, row.cluster)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
