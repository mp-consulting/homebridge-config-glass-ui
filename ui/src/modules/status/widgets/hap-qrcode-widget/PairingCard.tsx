import type { ReactNode } from 'react'

import { useTranslation } from 'react-i18next'

import { QrCode } from '@/core/components/qrcode/QrCode'
import { cx } from '@/core/utilities/cx'

import { usePairingCard } from './use-pairing-card'

import './pairing-card.scss'

export interface PairingCardProps {
  /** The header icon and label. */
  title: ReactNode
  /** Whether the paired / unpaired pill is shown. */
  showStatus: boolean
  paired: boolean
  pin: string
  setupUri: string | null
  /** What stands in for the code when there is none. */
  placeholder: ReactNode
  /** Measures and sizes the code; from {@link usePairingCard}. */
  card: ReturnType<typeof usePairingCard>
}

/** The markup the HAP and Matter pairing widgets share. */
export function PairingCard({ title, showStatus, paired, pin, setupUri, placeholder, card }: PairingCardProps) {
  const { t } = useTranslation()
  const copyLabel = t(card.pinCopied ? 'common.a11y.copied' : 'status.widget.pairing_copy_code')

  return (
    <div className="pairing-card d-flex flex-column w-100 h-100">
      <div className="pairing-card-header drag-handler d-flex align-items-center justify-content-between">
        <span className="pairing-card-title">{title}</span>
        {showStatus && (
          <span className={cx('pairing-status-pill', paired && 'is-paired')}>
            <span className="pairing-status-dot" aria-hidden="true"></span>
            {t(paired ? 'status.widget.qr_paired' : 'status.widget.qr_unpaired')}
          </span>
        )}
      </div>

      <div ref={card.containerRef} className="d-flex flex-column flex-grow-1 w-100 min-h-0">
        <div
          className={cx('pairing-qr-area d-flex align-items-center justify-content-center w-100', !setupUri && 'flex-grow-1')}
          style={setupUri ? { height: `${card.qrCodeHeight}px` } : undefined}
        >
          {setupUri
            ? (
                <div className="pairing-qr-tile" style={{ width: `${card.qrCodeWidth}px`, height: `${card.qrCodeWidth}px` }}>
                  <QrCode data={setupUri} />
                </div>
              )
            : <div className="pairing-qr-placeholder text-center">{placeholder}</div>}
        </div>

        <div ref={card.pinCodeRef} className="pairing-pin-area text-center w-100 mt-auto gridster-item-content">
          {pin && (
            <>
              <div className="pairing-pin-row d-flex align-items-center justify-content-center">
                <span className="pairing-pin font-monospace">{pin}</span>
                <button
                  type="button"
                  className="pairing-pin-copy"
                  aria-label={copyLabel}
                  title={copyLabel}
                  onClick={() => void card.copyPin()}
                >
                  <i aria-hidden="true" className={card.pinCopied ? 'fas fa-check' : 'far fa-copy'}></i>
                </button>
              </div>
              {!paired && <p className="pairing-hint mb-0">{t('status.code_scan')}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
