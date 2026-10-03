import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { AIR_QUALITY_LABELS, airQualityReadings } from '@/core/accessories/types/hap/air-quality-sensor/air-quality-sensor.utils'
import { ManageHeader } from '@/core/accessories/types/hap/manage-parts'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { cx } from '@/core/utilities/cx'

/** Read only: the overall rating and each concentration the sensor reports, kept live. */
export function AirQualitySensorManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()
  // Re-renders on every live update, so the readings are read off the newest service
  const m = useManageAccessory(initialService, { activeModal })
  const service = m.service
  const { airQuality, readings } = airQualityReadings(service)

  return (
    <div className="modal-content">
      <ManageHeader title={service.customName || service.serviceName || service.displayName} onClose={m.dismissModal} />
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
        {!!readings.length && (
          <ul className="list-group list-group-box mb-0">
            {readings.map(reading => (
              <li key={reading.key} className="list-group-item d-flex justify-content-between align-items-center">
                <span>{t(reading.label)}</span>
                <span className="grey-text">{`${reading.value} µg/m³`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
