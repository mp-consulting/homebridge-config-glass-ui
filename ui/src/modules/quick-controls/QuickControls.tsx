import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { accessories } from '@/core/accessories/accessories'
import { AccessoryTile } from '@/core/accessories/accessory-tile/AccessoryTile'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'

import { favouritesOf } from './favourites'

import './quick-controls.scss'

/**
 * `/quick`: a phone-sized page with just the favourite accessories, big
 * tiles grouped by room. The home screen app's "Quick Controls" shortcut
 * opens it.
 */
export function QuickControls() {
  const { t } = useTranslation()
  const [rooms, setRooms] = useState<Array<{ name: string, services: ServiceTypeX[] }>>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    settingsActions.setPageTitle(i18n.t('quick.title'))
  }, [])

  useEffect(() => {
    const refresh = () => {
      setRooms(favouritesOf(accessories.rooms()))
      setLoaded(true)
    }
    const offData = accessories.accessoryData.subscribe(refresh)
    let offLayout: (() => void) | undefined
    let active = true
    void accessories.start().then(() => {
      if (active) {
        offLayout = accessories.layoutSaved.subscribe(refresh)
      }
    })
    return () => {
      active = false
      offData()
      offLayout?.()
      accessories.stop()
    }
  }, [])

  return (
    <div className="hb-quick-controls">
      <h4 className="mb-3">{t('quick.title')}</h4>
      {!loaded
        ? <div className="text-center primary-text"><InlineSpinner className="icon-xl" /></div>
        : rooms.length === 0
          ? (
              <div className="text-center grey-text mt-4">
                <p>{t('quick.none')}</p>
                <Link to="/accessories" className="btn btn-primary">{t('menu.label_accessories')}</Link>
              </div>
            )
          : rooms.map(room => (
              <section key={room.name} className="mb-3" aria-label={room.name}>
                <h6 className="grey-text mb-2">{room.name}</h6>
                <div className="hb-quick-controls-grid">
                  {room.services.map(service => (
                    <div key={service.uniqueId} className="accessory-item noselect">
                      <AccessoryTile service={service} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
    </div>
  )
}
