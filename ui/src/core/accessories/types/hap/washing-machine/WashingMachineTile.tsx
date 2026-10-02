import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { currentConsumption, cx, hasCurrentConsumption } from '@/core/accessories/types/hap/hap-tile'
import { useLongPress } from '@/core/ui/use-long-press'

import './washing-machine.scss'

/** On / off only: there is no manage modal. */
export function WashingMachineTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const values = service.values
  const on = values?.On || values?.Active

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    if ('On' in service.values) {
      void service.getCharacteristic!('On').setValue!(!service.values.On)
    } else if ('Active' in service.values) {
      void service.getCharacteristic!('Active').setValue!(service.values.Active ? 0 : 1)
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick })

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box hb-washing-machine', on && 'accessory-on', readyForControl && 'cursor-pointer')}
      tabIndex={0}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.washing_machine')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* outer casing */}
            <rect x="3" y="1" width="25" height="30" rx="2" stroke="#7f7f7f" fill="none" strokeWidth="1.2" />
            {/* top drawer */}
            <rect x="6" y="4" width="5" rx="0.5" height="4" stroke="#7f7f7f" fill="none" strokeWidth="0.5" />
            <rect x="7" y="6" width="3" rx="0.25" height="1" stroke="#7f7f7f" fill="none" strokeWidth="0.25" />
            {/* control panel + buttons */}
            <rect x="14" y="4" width="11" height="4" rx="0.5" fill="none" stroke="#7f7f7f" strokeWidth="0.5" />
            <rect
              x="19"
              y="5"
              width="5"
              height="2"
              rx="0.25"
              fill="#1976d2"
              fillOpacity="0.5"
              stroke="#7f7f7f"
              strokeWidth="0.25"
            />
            <rect x="15" y="5" width="1" height="1" rx="0.25" fill="none" stroke="#7f7f7f" strokeWidth="0.25" />
            <rect x="16" y="5" width="1" height="1" rx="0.25" fill="none" stroke="#7f7f7f" strokeWidth="0.25" />
            <rect x="17" y="5" width="1" height="1" rx="0.25" fill="none" stroke="#7f7f7f" strokeWidth="0.25" />
            <rect x="15" y="6" width="1" height="1" rx="0.25" fill="none" stroke="#7f7f7f" strokeWidth="0.25" />
            <rect x="16" y="6" width="1" height="1" rx="0.25" fill="none" stroke="#7f7f7f" strokeWidth="0.25" />
            <rect x="17" y="6" width="1" height="1" rx="0.25" fill="none" stroke="#7f7f7f" strokeWidth="0.25" />
            {/* drum handle */}
            <rect className="handle" x="19" y="15.5" rx="1" width="3" height="3" fill="#7f7f7f" />
            {/* drum */}
            <circle cx="15.5" cy="17" r="6.5" stroke="#7f7f7f" fill="none" strokeWidth="1.2" />
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text">
          {t(on ? 'accessories.control.on' : 'accessories.control.off')}
          {on && hasCurrentConsumption(service) && ` · ${currentConsumption(service)}W`}
        </div>
      </div>
    </div>
  )
}
