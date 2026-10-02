import type { HomebridgeStatusResponse } from '@/core/interfaces/server.interfaces'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '@/core/auth'
import { useNamespace, useSocketEvent } from '@/core/ws'
import { PairingCard } from '@/modules/status/widgets/hap-qrcode-widget/PairingCard'
import { usePairingCard } from '@/modules/status/widgets/hap-qrcode-widget/use-pairing-card'

export function MatterQrcodeWidget({ resizeEvent }: WidgetProps) {
  const { t } = useTranslation()
  // Pairing codes are admin-only: the server leaves the pin and setup code out for
  // everyone else, so those users get a notice instead of an empty code area
  const isAdmin = useAuthStore(state => state.user.admin)
  // Use the existing status namespace instead of matter-bridges
  const io = useNamespace('status')

  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [commissioned, setCommissioned] = useState(false)
  const [pin, setPin] = useState('')
  const [setupUri, setSetupUri] = useState<string | null>(null)

  const card = usePairingCard(resizeEvent, pin)
  const { scheduleResize } = card

  const applyMatterStatus = (data: HomebridgeStatusResponse): void => {
    if (data.matter) {
      setEnabled(data.matter.enabled)
      if (data.matter.enabled) {
        // The pin does not change while the fabric exists: keep the last one when an update omits it
        const matterPin = data.matter.pin
        setPin(current => matterPin || current)
        setCommissioned(data.matter.commissioned || false)
        setSetupUri(data.matter.setupUri || null)
      } else {
        setSetupUri(null)
        setCommissioned(false)
      }
    } else {
      setEnabled(false)
      setPin('')
      setSetupUri(null)
      setCommissioned(false)
    }
    setLoading(false)
    scheduleResize()
  }

  // Listen to homebridge-status events for unified status updates
  useSocketEvent<[HomebridgeStatusResponse]>(io, 'homebridge-status', applyMatterStatus)

  // Request the homebridge pairing pin, which includes the Matter info, if already connected
  const applyRef = useRef(applyMatterStatus)
  applyRef.current = applyMatterStatus
  useEffect(() => {
    if (io?.socket.connected) {
      void io.request<HomebridgeStatusResponse>('get-homebridge-pairing-pin').then(data => applyRef.current(data))
    }
  }, [io])

  let placeholder
  if (loading) {
    placeholder = <i className="fas fa-circle-notch fa-spin fa-2xl" aria-hidden="true"></i>
  } else if (!enabled) {
    placeholder = (
      <>
        <i className="fas fa-matter fa-2xl" aria-hidden="true"></i>
        <p className="mt-3 mb-0 small">{t('status.services.matter_not_enabled')}</p>
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
          <i className="fas fa-matter" aria-hidden="true"></i>
          {' '}
          Matter
        </>
      )}
      showStatus={enabled && (!!pin || !isAdmin)}
      paired={commissioned}
      pin={pin}
      setupUri={setupUri}
      placeholder={placeholder}
      card={card}
    />
  )
}
