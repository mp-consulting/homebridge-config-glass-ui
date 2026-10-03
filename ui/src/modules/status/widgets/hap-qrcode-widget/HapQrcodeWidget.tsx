import type { HomebridgeStatusResponse } from '@/core/interfaces/server.interfaces'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '@/core/auth'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { useNamespace, useSocketEvent } from '@/core/ws'

import { PairingCard } from './PairingCard'
import { usePairingCard } from './use-pairing-card'

export function HapQrcodeWidget({ resizeEvent }: WidgetProps) {
  const { t } = useTranslation()
  // Pairing codes are admin-only: the server leaves the pin and setup code out for
  // everyone else, so those users get a notice instead of an empty code area
  const isAdmin = useAuthStore(state => state.user.admin)
  const io = useNamespace('status')

  const [enabled, setEnabled] = useState(true)
  // True when the main bridge is in HAP externalsOnly mode — the bridge
  // accessory itself isn't published, but plugins may still publish external
  // HAP accessories. The widget hides the QR/PIN and shows an externalsOnly
  // notice instead, since there's no main bridge to pair.
  const [externalsOnly, setExternalsOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [paired, setPaired] = useState(false)
  const [pin, setPin] = useState('')
  const [setupUri, setSetupUri] = useState<string | null>(null)

  const card = usePairingCard(resizeEvent, pin)
  const { scheduleResize } = card

  const applyHapStatus = (data: HomebridgeStatusResponse): void => {
    // HAP defaults to enabled when the status payload doesn't carry the flag.
    // externalsOnly is only meaningful when the bridge accessory is not being
    // published — in that mode we hide the QR/PIN since there's nothing to pair.
    const hapEnabled = data.hap ? data.hap.enabled : true
    const isExternalsOnly = data.hap?.externalsOnly === true
    setEnabled(hapEnabled)
    setExternalsOnly(isExternalsOnly)
    if (hapEnabled && !isExternalsOnly) {
      setPin(data.pin)
      setPaired(data.paired)
      if (data.setupUri) {
        setSetupUri(data.setupUri)
      }
    } else {
      setPin('')
      setPaired(false)
      setSetupUri(null)
    }
    setLoading(false)
    scheduleResize()
  }

  useSocketEvent<[HomebridgeStatusResponse]>(io, 'homebridge-status', applyHapStatus)

  // Fetch initial data if already connected; later changes arrive as homebridge-status
  const applyRef = useRef(applyHapStatus)
  applyRef.current = applyHapStatus
  useEffect(() => {
    if (io?.socket.connected) {
      void io.request<HomebridgeStatusResponse>('get-homebridge-pairing-pin').then(data => applyRef.current(data))
    }
  }, [io])

  let placeholder
  if (loading) {
    placeholder = <InlineSpinner className="fa-2xl" />
  } else if (externalsOnly) {
    // HAP externalsOnly: the bridge itself isn't published, only external accessories
    placeholder = (
      <>
        <i className="fas fa-hap fa-2xl text-info" aria-hidden="true"></i>
        <p className="mt-3 mb-0 small">{t('status.services.hap_externals_only')}</p>
      </>
    )
  } else if (!enabled) {
    placeholder = (
      <>
        <i className="fas fa-hap fa-2xl" aria-hidden="true"></i>
        <p className="mt-3 mb-0 small">{t('status.services.hap_not_enabled')}</p>
      </>
    )
  } else if (!isAdmin) {
    placeholder = (
      <>
        <i className="fas fa-lock fa-2xl" aria-hidden="true"></i>
        <p className="mt-3 mb-0 small">{t('status.widget.pairing_admin_only')}</p>
      </>
    )
  } else {
    placeholder = (
      <>
        <i className="fas fa-qrcode fa-2xl" aria-hidden="true"></i>
        <p className="mt-3 mb-0 small">{t('status.widget.pairing_waiting')}</p>
      </>
    )
  }

  return (
    <PairingCard
      title={(
        <>
          <i className="fas fa-hap" aria-hidden="true"></i>
          {' '}
          {t('status.widget.hap_title')}
        </>
      )}
      showStatus={enabled && !externalsOnly && (!!pin || !isAdmin)}
      paired={paired}
      pin={pin}
      setupUri={setupUri}
      placeholder={placeholder}
      card={card}
    />
  )
}
