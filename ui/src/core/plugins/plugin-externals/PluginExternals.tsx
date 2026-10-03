import type { ModalComponentProps } from '@/core/ui/modal'
import type { PluginExternalsModalData } from '@/core/ui/modal-data'
import type { SyntheticEvent } from 'react'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { serverPairingsCache } from '@/core/caching'
import { QrCode } from '@/core/components/qrcode/QrCode'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { DEFAULT_PLUGIN_ICON } from '@/core/constants/assets'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'
import { toastApiError } from '@/core/utilities/http-error'

import './plugin-externals.scss'

interface ExternalAccessoryPairing {
  _id: string
  _username: string
  _isPaired: boolean
  _setupCode?: string
  _matter?: boolean
  _matterOnly?: boolean
  _port?: number
  pincode?: string
  name?: string
  displayName?: string
  manufacturer?: string
  model?: string
  serialNumber?: string
}

export type PluginExternalsProps = PluginExternalsModalData & ModalComponentProps

/** The accessories a plugin publishes outside its bridge (external / Matter-only), with their pairing codes. */
export function PluginExternals({ activeModal, plugin }: PluginExternalsProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [accessories, setAccessories] = useState<ExternalAccessoryPairing[]>([])
  const [selectedIndex, setSelectedIndex] = useState('0')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const pairings = await serverPairingsCache.get<any[]>()
        const filtered: ExternalAccessoryPairing[] = (pairings ?? [])
          .filter(p => p._plugin === plugin.name && (p._isExternal === true || p._matterOnly === true))
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
        if (!cancelled) {
          setAccessories(filtered)
        }
      } catch (error) {
        console.error(error)
        toastApiError(error, 'external_accessories.toast_failed_to_load')
        if (!cancelled) {
          setAccessories([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [plugin.name])

  const selected = (() => {
    if (accessories.length === 0) {
      return undefined
    }
    const idx = Number.parseInt(selectedIndex, 10)
    return accessories[Number.isFinite(idx) ? idx : 0]
  })()

  const closeModal = () => activeModal.dismiss()
  const handleIconError = (event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.src = DEFAULT_PLUGIN_ICON
  }

  const row = (label: string, value: string | number) => (
    <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
      <span className="mb-2 mb-md-0 w-100 w-md-50">{t(label)}</span>
      <div className="text-start text-md-end w-100 w-md-50 grey-text font-monospace">
        {value}
      </div>
    </li>
  )

  const renderSelected = (accessory: ExternalAccessoryPairing) => (
    <>
      <ul className="list-group list-group-box mb-3">
        {accessories.length > 1
          ? (
              <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                <label htmlFor="externalSelect" className="mb-2 mb-md-0 w-100 w-md-50">
                  {t('external_accessories.select_accessory')}
                </label>
                <div className="text-start text-md-end w-100 w-md-50">
                  <select
                    className="custom-select"
                    id="externalSelect"
                    value={selectedIndex}
                    onChange={event => setSelectedIndex(event.target.value)}
                  >
                    {accessories.map((item, index) => (
                      <option key={item._id} value={index}>{item.displayName || item.name}</option>
                    ))}
                  </select>
                </div>
              </li>
            )
          : row('external_accessories.select_accessory', accessory.displayName || accessory.name || '')}
        <li className="list-group-item text-center">
          <div className="w-100 d-flex flex-column text-center pt-2">
            {accessory._setupCode
              ? (
                  // was <app-qrcode class="mx-auto qr-code-size">
                  <div className="mx-auto qr-code-size"><QrCode data={accessory._setupCode} /></div>
                )
              : <p className="grey-text my-3">{t('external_accessories.no_setup_code')}</p>}
            {accessory.pincode && <p className="mx-auto mt-3 mb-1 font-monospace">{accessory.pincode}</p>}
            <p className="grey-text mx-auto small mb-1 qr-code-info">
              <i
                aria-hidden="true"
                className={cx('fas fa-link', accessory._isPaired && 'green-text', !accessory._isPaired && 'grey-text')}
              >
              </i>
              {' '}
              {t(accessory._isPaired ? 'status.widget.qr_paired' : 'status.widget.qr_unpaired')}
              {!accessory._isPaired && accessory._setupCode && (
                <span>
                  {' · '}
                  {t('status.code_scan')}
                </span>
              )}
            </p>
          </div>
        </li>
      </ul>

      <ul className="list-group list-group-box">
        {row('external_accessories.protocol', accessory._matter || accessory._matterOnly ? 'Matter' : 'HAP')}
        {accessory.manufacturer && row('external_accessories.manufacturer', accessory.manufacturer)}
        {accessory.model && row('external_accessories.model', accessory.model)}
        {accessory.serialNumber && row('external_accessories.serial_number', accessory.serialNumber)}
        {accessory._username && row('external_accessories.username', accessory._username)}
        {accessory._port ? row('external_accessories.port', accessory._port) : null}
      </ul>
    </>
  )

  return (
    <div className="modal-content hb-plugin-externals">
      <ModalHeader title={plugin.displayName || plugin.name} onClose={closeModal} />
      <div className="modal-body">
        {loading
          ? (
              <div className="text-center primary-text my-5 w-100">
                <InlineSpinner className="icon-xl" />
              </div>
            )
          : (
              <>
                <div className="text-center">
                  <img
                    alt=""
                    aria-hidden="true"
                    className="mb-3 plugin-icon-card"
                    src={plugin.icon || DEFAULT_PLUGIN_ICON}
                    onError={handleIconError}
                  />
                </div>

                {accessories.length === 0
                  ? <p className="text-center grey-text">{t('external_accessories.no_accessories')}</p>
                  : (
                      <>
                        <ul className="mb-3">
                          <li>{t('external_accessories.about')}</li>
                        </ul>
                        {selected && renderSelected(selected)}
                      </>
                    )}
              </>
            )}
      </div>
      <ModalFooter>
        <div className="text-start"></div>
        <div className="text-center">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            onClick={closeModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-end"></div>
      </ModalFooter>
    </div>
  )
}
