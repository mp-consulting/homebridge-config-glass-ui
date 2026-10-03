import type { ModalComponentProps } from '@/core/ui/modal'
import type { NetworkAdapterAvailable, NetworkAdapterSelected } from '@/modules/settings/settings.interfaces'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'

export interface SelectNetworkInterfacesProps extends ModalComponentProps<string[]> {
  adaptersAvailable: NetworkAdapterAvailable[]
  adaptersSelected: NetworkAdapterSelected[]
}

/**
 * Pick the network interfaces the bridge advertises on. Closes with the
 * chosen interface names; dismissing changes nothing.
 *
 * Unlike the Angular modal, the ticks are kept here rather than written onto
 * the adapter objects the page passed in, so closing without saving has
 * nothing to put back.
 */
export function SelectNetworkInterfaces({ activeModal, adaptersAvailable, adaptersSelected }: SelectNetworkInterfacesProps) {
  const { t } = useTranslation()
  const [adaptersOriginal] = useState(() => adaptersSelected.map(x => x.iface))
  // The `selected` flag of each available adapter, from the selected adapters
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(adaptersAvailable.map(adapter => [adapter.iface, adaptersSelected.some(x => x.iface === adapter.iface)])),
  )

  // Worked out on the first tick, not before: an interface the bridge was on
  // that has since gone does not count as a change by itself
  const [touched, setTouched] = useState(false)

  const chosen = adaptersAvailable.filter(x => selected[x.iface])
  const isUnchanged = !touched || (adaptersOriginal.length === chosen.length
    && adaptersOriginal.every(original => adaptersAvailable.some(x => x.iface === original && selected[x.iface])))

  const submit = () => activeModal.close(chosen.map(x => x.iface))
  const closeAndReset = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <ModalHeader title={t('settings.network.title_network_interfaces')} onClose={closeAndReset} />
      <div className="modal-body">
        <div className="text-center mb-3"><i className="fas fa-ethernet primary-text icon-xl"></i></div>
        <ul className="mb-3">
          <li>{t('settings.network.message_network_interface')}</li>
        </ul>
        <ul className="list-group list-group-box">
          {adaptersAvailable.map(adapter => (
            <li key={adapter.iface} className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
              <div>
                <span className="font-monospace">{adapter.ip4 || adapter.ip6}</span>
                <br />
                <span className="font-monospace grey-text">{adapter.iface}</span>
              </div>
              <span>
                <input
                  type="checkbox"
                  className="rendux-input"
                  id={`adapter${adapter.iface}`}
                  checked={!!selected[adapter.iface]}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setSelected(current => ({ ...current, [adapter.iface]: checked }))
                    setTouched(true)
                  }}
                />
                <label className="rendux-label ms-3" htmlFor={`adapter${adapter.iface}`}></label>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            onClick={closeAndReset}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button
            type="button"
            className="btn btn-primary"
            data-bs-dismiss="modal"
            disabled={isUnchanged}
            onClick={submit}
          >
            {t('form.button_save')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
