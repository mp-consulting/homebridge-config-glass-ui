import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { controlDevice, getDeviceActiveState } from '@/core/accessories/types/matter/matter-device.utils'
import { classes, onEnterOrSpace, tileName, tileSrText } from '@/core/accessories/types/matter/matter-tile'

export function OnOffLightSwitchTile({ service, readyForControl = false }: MatterTileProps) {
  const { t } = useTranslation()

  const on = getDeviceActiveState(service)
  const stateText = on ? t('accessories.control.on') : t('accessories.control.off')
  const srText = tileSrText(service, t('accessories.core.switch'), stateText)

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    controlDevice(service)
  }

  return (
    <div
      className={classes('accessory-box', on && 'accessory-on', readyForControl && 'cursor-pointer')}
      role="switch"
      tabIndex={0}
      aria-checked={on}
      aria-label={srText}
      onClick={onClick}
      onKeyDown={onEnterOrSpace(onClick)}
    >
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
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
            {/* outer circle */}
            <circle cx="16" cy="16" r="14" fill="none" stroke="#7f7f7f" strokeWidth="2" />
            {/* vertical line */}
            <line x1="16" y1="8" x2="16" y2="14" stroke="#7f7f7f" strokeWidth="2" strokeLinecap="round" />
            {/* horseshoe shape */}
            <path
              fill="#7f7f7f"
              d="M21.4589329,9.49999998
                C21,9.97698687 21.1735519,10.8351 21.4589326,11.2029426
                C22.4505994,12.4811551 23,14.065977 23,15.7447101
                C23,19.7640218 19.8532802,23 16,23
                C12.1467198,23 9,19.7640218 9,15.7447101
                C9,14.0415493 9.56560927,12.4352187 10.5838497,11.1483389
                C10.8725653,10.7834523 11,9.9670534 10.5,9.49999999
                C10,9.03294657 9.01543812,9.9073372 9.01543812,9.9073372
                C7.75536735,11.4998488 7,13.5315645 7,15.7447101
                C7,20.8562656 11.0294373,25 16,25
                C20.9705627,25 25,20.8562656 25,15.7447101
                C25,13.5637007 24.2664101,11.5588905 23.0391328,9.97698685
                C23.0391328,9.97698685 21.9178658,9.0230131 21.4589329,9.49999998 Z"
            />
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">
          {tileName(service)}
        </div>
        <div className="accessory-label grey-text" aria-hidden="true">
          {t(on ? 'accessories.control.on' : 'accessories.control.off')}
        </div>
      </div>
    </div>
  )
}
