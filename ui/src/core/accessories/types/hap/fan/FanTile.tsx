import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { currentConsumption, hasCurrentConsumption } from '@/core/accessories/types/hap/hap-tile'
import { FanManage } from '@/core/accessories/types/hap/lazy-manage'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './fan.scss'

export function FanTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()

  // Decided once, as in ngOnInit
  const [{ rotationSpeedUnit, hasRotationDirection }] = useState(() => ({
    // Find the unit for the rotation speed
    rotationSpeedUnit: 'RotationSpeed' in service.values
      && service.serviceCharacteristics.find(c => c.type === 'RotationSpeed')?.unit === 'percentage'
      ? '%'
      : '',
    hasRotationDirection: 'RotationDirection' in service.values,
  }))

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    const values = service.values

    if ('On' in values) {
      void service.getCharacteristic!('On').setValue!(!values.On)
    } else if ('Active' in values) {
      void service.getCharacteristic!('Active').setValue!(values.Active ? 0 : 1)
    }

    // Set the rotation speed to max if on 0% when turned on
    if ('RotationSpeed' in values && !values.On && !values.RotationSpeed) {
      values.RotationSpeed = service.getCharacteristic!('RotationSpeed').maxValue
    }
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    if ('RotationSpeed' in service.values || 'RotationDirection' in service.values) {
      openModal(FanManage, { service }, { size: 'md', backdrop: 'static' })
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })
  const values = service.values
  const running = values?.On || values?.Active

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box hb-fan', (values.On || values.Active) && 'accessory-on', readyForControl && 'cursor-pointer')}
      tabIndex={0}
    >
      <div className="d-flex flex-column h-100">
        <div
          className={cx(
            'accessory-svg',
            running && (!hasRotationDirection || (hasRotationDirection && values?.RotationDirection === 0)) && 'spin',
            running && hasRotationDirection && values?.RotationDirection === 1 && 'spin-counter',
          )}
          aria-label={t('accessories.core.fan')}
        >
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* fan icon */}
            <g transform="translate(-0.85, 0.2) scale(0.99)">
              <path
                className="fan-blades"
                fill="#7f7f7f"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M20.988 10.265c.382-.596.951-1.424 1.844-2.71C25.462 3.61 23.456 0 18 0c-6.263 0-10.09 5.649-6.835 11.923-.594-.382-1.416-.948-2.682-1.826-3.945-2.63-7.555-.625-7.555 4.832 0 6.308 5.73 10.145 12.057 6.763-.383.599-.958 1.436-1.872 2.753C8.485 28.39 10.49 32 15.947 32c6.267 0 10.095-5.655 6.83-11.932.593.382 1.412.946 2.668 1.818 3.945 2.63 7.555.625 7.555-4.832 0-6.293-5.703-10.127-12.012-6.788Zm-.407 2.602C26.101 8.924 31 11.805 31 17.053c0 3.877-1.845 4.902-4.445 3.169-2.525-1.761-3.46-2.385-4.406-2.763a7.87 7.87 0 0 0-1.01-.317c.105-.382.161-.785.161-1.2 0-1.327-.919-3.134-.919-3.134ZM18.405 10.85c.378-.946 1.001-1.88 2.763-4.405C22.902 3.845 21.877 2 18 2c-5.247 0-8.129 4.899-4.186 10.419 0 0 1.89-.919 3.186-.919.398 0 .783.052 1.15.149.064-.269.149-.533.255-.798ZM11.78 14.524c-.946-.378-1.88-1.001-4.405-2.763-2.6-1.734-4.445-.709-4.445 3.168 0 5.247 4.899 8.129 10.419 4.186 0 0-.848-1.812-.848-3.115 0-.416.057-.819.163-1.201a7.81 7.81 0 0 0-1.183-.275Zm3.763 6.625c-.378.946-1.001 1.88-2.763 4.405-1.734 2.6-.709 4.445 3.168 4.445 5.248 0 8.13-4.899 4.187-10.419 0 0-1.831.919-3.133.919-.416 0-.819-.057-1.201-.162a7.802 7.802 0 0 0-.258.812ZM17 19.5c-1.933 0-3.5-1.567-3.5-3.5s1.567-3.5 3.5-3.5 3.5 1.567 3.5 3.5-1.567 3.5-3.5 3.5Z"
              />
            </g>
            {/* middle circle */}
            <circle cx="16" cy="16" r="3.6" stroke="#7f7f7f" strokeWidth="2" fill="#1976d2" fillOpacity="0.5" />
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        {values?.On && values?.RotationSpeed
          ? <div className="accessory-label grey-text">{`${values?.RotationSpeed}${rotationSpeedUnit}`}</div>
          : (
              <div className="accessory-label grey-text">
                {t(running ? 'accessories.control.on' : 'accessories.control.off')}
                {running && hasCurrentConsumption(service) && ` · ${currentConsumption(service)}W`}
              </div>
            )}
      </div>
    </div>
  )
}
