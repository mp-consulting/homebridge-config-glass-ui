import type { AccessoryHistoryStatus } from './accessory-history'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useAuthStore } from '@/core/auth'
import { cx } from '@/core/utilities/cx'

import { fetchAccessoryHistoryStatus } from './accessory-history'

/**
 * Why the accessory history is not being recorded, when it is not: Homebridge
 * is not in insecure mode (with a link to that setting for administrators),
 * or the recorder could not attach. Renders nothing while it records, while
 * it is switched off (`showDisabled` to say so), or when the server is too
 * old to say.
 */
export function AccessoryHistoryNotice({ className, showDisabled = false, linkToSetting = true }: { className?: string, showDisabled?: boolean, linkToSetting?: boolean }) {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => !!state.user?.admin)
  const [status, setStatus] = useState<AccessoryHistoryStatus | null>(null)

  useEffect(() => {
    let active = true
    fetchAccessoryHistoryStatus().then(
      (value) => {
        if (active) {
          setStatus(value)
        }
      },
      () => undefined,
    )
    return () => {
      active = false
    }
  }, [])

  if (!status || status.recording || status.reason === 'starting' || (status.reason === 'disabled' && !showDisabled)) {
    return null
  }

  let message: string
  if (status.reason === 'insecureModeRequired') {
    message = t('accessories.history.notice_insecure')
  } else if (status.reason === 'disabled') {
    message = t('accessories.history.notice_disabled')
  } else {
    message = t('accessories.history.notice_error', { error: status.error ?? '' })
  }

  return (
    <div className={cx('alert alert-warning small mb-0 hb-accessory-history-notice', className)} role="status">
      <i className="fas fa-triangle-exclamation me-2" aria-hidden="true"></i>
      {message}
      {status.reason === 'insecureModeRequired' && isAdmin && linkToSetting && (
        <>
          {' '}
          <Link to="/settings?section=startup">{t('accessories.history.notice_open_setting')}</Link>
        </>
      )}
    </div>
  )
}
