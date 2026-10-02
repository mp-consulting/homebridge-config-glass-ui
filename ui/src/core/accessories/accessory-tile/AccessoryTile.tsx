import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

import { useTranslation } from 'react-i18next'

import { accessories, useAccessoriesStore } from '@/core/accessories/accessories'
import { tileFor } from '@/core/accessories/accessory-tile/tile-map'

export interface AccessoryTileProps {
  service: ServiceTypeX
}

/**
 * One accessory on the rooms page or the dashboard widget: the menu button
 * (a spinner until the protocol is ready for control) and the tile for its type.
 */
export function AccessoryTile({ service }: AccessoryTileProps) {
  const { t } = useTranslation()
  const isMatter = service.protocol === 'matter'
  const readyForControl = useAccessoriesStore(state => (isMatter ? state.matterReadyForControl : state.hapReadyForControl))

  const entry = tileFor(service)
  const Tile = entry.component
  const tile = entry.control
    ? <Tile service={service} readyForControl={readyForControl} {...entry.props} />
    : <Tile service={service} {...entry.props} />
  const label = `${t('form.button_edit')} ${service.customName || service.serviceName}`

  const showInformation = () => {
    void accessories.showAccessoryInformation(service)
  }

  return (
    <>
      {readyForControl
        ? (
            <button
              type="button"
              className={service.hidden ? 'manage-accessory-button accessory-hidden-indicator' : 'manage-accessory-button'}
              aria-label={label}
              onClick={showInformation}
            >
              {service.hidden
                ? (
                    <>
                      <i className="fas fa-eye-slash grey-text accessory-hidden-icon" aria-hidden="true"></i>
                      <i className="fas fa-bars grey-text accessory-hidden-hover-icon" aria-hidden="true"></i>
                    </>
                  )
                : <i className="fas fa-bars grey-text" aria-hidden="true"></i>}
            </button>
          )
        : (
            <button
              type="button"
              className="refreshing-accessory-button"
              aria-label={label}
              onClick={showInformation}
            >
              <i className="fas fa-circle-notch fa-spin grey-text" aria-hidden="true"></i>
            </button>
          )}
      {entry.hostClass
        ? <div className={entry.hostClass}>{tile}</div>
        : tile}
    </>
  )
}
