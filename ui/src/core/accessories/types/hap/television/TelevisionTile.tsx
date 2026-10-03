import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { currentConsumption, hasCurrentConsumption } from '@/core/accessories/types/hap/hap-tile'
import { televisionInputs } from '@/core/accessories/types/hap/television/television.utils'
import { TelevisionManage } from '@/core/accessories/types/hap/television/TelevisionManage'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './television.scss'

export function TelevisionTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  // Built once, as in ngOnInit
  const [channelList] = useState<Record<number, string>>(() => Object.fromEntries(
    televisionInputs(service).map(input => [input.identifier, input.name]),
  ))
  const values = service.values

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    if ('Active' in service.values) {
      void service.getCharacteristic!('Active').setValue!(service.values.Active ? 0 : 1)
    } else if ('On' in service.values) {
      void service.getCharacteristic!('On').setValue!(!service.values.On)
    }
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    if ('Active' in service.values || Object.keys(channelList).length) {
      openModal(TelevisionManage, { service }, { size: 'md', backdrop: 'static' })
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box hb-television', (values?.Active || values?.On) && 'accessory-on', readyForControl && 'cursor-pointer')}
      tabIndex={0}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.television')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* stand */}
            <line
              className="stand"
              x1="10"
              y1="27.25"
              x2="22"
              y2="27.25"
              stroke="#d32f2f"
              strokeWidth="4"
              strokeLinecap="round"
              strokeOpacity="0.75"
            />
            {/* frame */}
            <rect
              className="screen"
              x="1"
              y="6"
              width="30"
              height="20"
              rx="2"
              stroke="#7f7f7f"
              fill="#808080"
              strokeWidth="1.5"
            />
          </svg>
        </div>
        <div className="accessory-label mt-auto">
          {service.customName || values?.ConfiguredName || service.serviceName}
        </div>
        {values?.On || values?.Active
          ? (
              <div className="accessory-label grey-text">
                {channelList[values?.ActiveIdentifier] || t('accessories.control.on')}
                {hasCurrentConsumption(service) && ` · ${currentConsumption(service)}W`}
              </div>
            )
          : <div className="accessory-label grey-text">{t('accessories.control.off')}</div>}
      </div>
    </div>
  )
}
