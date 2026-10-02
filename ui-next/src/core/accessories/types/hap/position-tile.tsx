import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

import { useTranslation } from 'react-i18next'

/**
 * The state line under a door, window or window covering: closed / open n% /
 * open while still, opening… / closing… while moving.
 */
export function PositionLabel({ service, a11y = false }: { service: ServiceTypeX, a11y?: boolean }) {
  const { t } = useTranslation()
  const pos = service.values?.CurrentPosition
  const posState = service.values?.PositionState
  const hidden = a11y ? { 'aria-hidden': true as const } : {}

  if (posState === 2) {
    return (
      <div className="accessory-label grey-text" {...hidden}>
        {pos === 0 && t('accessories.control.closed')}
        {pos > 0 && pos < 100 && `${t('accessories.control.open')} ${pos}%`}
        {pos === 100 && t('accessories.control.open')}
      </div>
    )
  }
  if (posState === 1) {
    return <div className="accessory-label red-text" {...hidden}>{`${t('accessories.control.opening')}...`}</div>
  }
  if (posState === 0) {
    return <div className="accessory-label red-text" {...hidden}>{`${t('accessories.control.closing')}...`}</div>
  }
  return null
}
