import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { hasCoAlarm, hasSmokeAlarm, isSmokeCoAlarmTriggered } from '@/core/accessories/types/matter/matter-device.utils'
import { sensorSrText } from '@/core/accessories/types/matter/matter-tile'
import { cx } from '@/core/utilities/cx'

import './smoke-co-alarm.scss'

/**
 * Both alarms share one cluster and one Matter device type, but a plugin can
 * register either on its own - so an accessory shown here may sense only
 * carbon monoxide, only smoke, or both. A combined alarm keeps the generic
 * "ALARM" face, which is what it is.
 * @param service - the accessory service
 */
function alarmKind(service: ServiceTypeX): 'smoke' | 'co' | 'both' {
  const smoke = hasSmokeAlarm(service)
  const co = hasCoAlarm(service)

  if (smoke && co) {
    return 'both'
  }
  // Matter requires at least one of the two, so a device claiming neither is
  // malformed - call it smoke, matching the SmokeSensor device type it came in under
  return co ? 'co' : 'smoke'
}

/** The Matter smoke / CO alarm tile (Angular `MatterSmokeCoAlarmComponent`). */
export function MatterSmokeCoAlarmTile({ service }: Pick<MatterTileProps, 'service'>) {
  const { t } = useTranslation()

  const triggered = isSmokeCoAlarmTriggered(service)
  const kind = alarmKind(service)
  const typeKey = kind === 'co'
    ? 'accessories.core.carbon_monoxide_sensor'
    : 'accessories.core.smoke_sensor'
  const stateText = triggered ? t('accessories.control.detected') : t('accessories.control.not_detected')
  const srText = sensorSrText(service, t(typeKey), stateText)

  return (
    <div className={cx('accessory-box hb-matter-smoke-co-alarm', triggered && 'accessory-on')}>
      <span className="visually-hidden">
        {srText}
      </span>
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-hidden="true">
          <svg
            width="32px"
            height="32px"
            viewBox="0 0 32 32"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
            aria-hidden="true"
          >
            {/* outer casing */}
            <rect x="1" y="1" width="30" height="12" rx="1" stroke="#7f7f7f" fill="none" strokeWidth="1.25" />
            {/* alarm type */}
            <text
              className="type"
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="Arial"
              fontSize="7.5"
              x="16"
              y="7.7"
              fill="#7f7f7f"
              strokeWidth="0.6"
              fontWeight="900"
            >
              {kind === 'smoke' ? 'SMOKE' : kind === 'co' ? 'CO' : 'ALARM'}
            </text>
            {/* grille blue background */}
            <line x1="6" y1="14.5" x2="25.5" y2="14.5" stroke="#1976d2" strokeOpacity="0.5" strokeWidth="2" />
            {/* grille vertical lines */}
            <line strokeLinecap="round" x1="5" y1="13" x2="6.5" y2="16" stroke="#7f7f7f" strokeWidth="1.25" />
            <line strokeLinecap="round" x1="11" y1="13" x2="11" y2="16" stroke="#7f7f7f" strokeWidth="1" />
            <line strokeLinecap="round" x1="15.5" y1="13" x2="15.5" y2="16" stroke="#7f7f7f" strokeWidth="1" />
            <line strokeLinecap="round" x1="20" y1="13" x2="20" y2="16" stroke="#7f7f7f" strokeWidth="1" />
            <line strokeLinecap="round" x1="26" y1="13" x2="24.5" y2="16" stroke="#7f7f7f" strokeWidth="1.25" />
            {/* grille horizontal lines */}
            <line strokeLinecap="round" x1="6.5" y1="16" x2="24.5" y2="16" stroke="#7f7f7f" strokeWidth="1.25" />
            {kind === 'co'
              ? (
                  <>
                    {/* gas waves, as on the HAP carbon monoxide sensor */}
                    <path
                      d="M3,23 C6,25 9,21 12,23 C15,25 18,21 21,23 C24,25 27,21 30,23"
                      className="air-line"
                      stroke="#7f7f7f"
                      fill="transparent"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M3,30 C6,32 9,28 12,30 C15,32 18,28 21,30 C24,32 27,28 30,30"
                      className="air-line"
                      stroke="#7f7f7f"
                      fill="transparent"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </>
                )
              : (
                  <>
                    {/* left to right air lines */}
                    <line
                      strokeLinecap="round"
                      x1="11"
                      y1="21"
                      x2="6"
                      y2="27"
                      stroke="#7f7f7f"
                      strokeWidth="1.25"
                      className="air-line"
                    />
                    <line
                      strokeLinecap="round"
                      x1="16"
                      y1="21"
                      x2="16"
                      y2="31"
                      stroke="#7f7f7f"
                      strokeWidth="1.25"
                      className="air-line"
                    />
                    <line
                      strokeLinecap="round"
                      x1="21"
                      y1="21"
                      x2="26"
                      y2="27"
                      stroke="#7f7f7f"
                      strokeWidth="1.25"
                      className="air-line"
                    />
                  </>
                )}
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">{service.customName || service.serviceName}</div>
        {triggered
          ? <div className="accessory-label red-text" aria-hidden="true">{t('accessories.control.detected')}</div>
          : (
              <div className="accessory-label grey-text" aria-hidden="true">
                {t('accessories.control.not_detected')}
              </div>
            )}
      </div>
    </div>
  )
}
