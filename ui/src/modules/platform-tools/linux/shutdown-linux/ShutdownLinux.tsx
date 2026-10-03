import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'

/** Shutting the host down. Nothing is coming back, so there is nothing to wait for. */
export function ShutdownLinux() {
  const { t } = useTranslation()
  const [error, setError] = useState<string | false>(false)
  // Sent once per page, even though StrictMode runs the effect twice
  const sentRef = useRef(false)

  useEffect(() => {
    if (sentRef.current) {
      return
    }
    sentRef.current = true
    api.put('/platform-tools/linux/shutdown-host', {})
      .catch((shutdownError: unknown) => {
        console.error(shutdownError)
        setError(i18n.t('platform.linux.server_shutdown_error'))
        toast.error(i18n.t('platform.linux.server_shutdown_error'), i18n.t('toast.title_error'))
      })
  }, [])

  return (
    <>
      <div className="d-flex justify-content-between">
        <h3 className="primary-text m-0">{t('menu.restart.title')}</h3>
      </div>

      <div className="my-4 align-items-center container-narrow">
        <div className="w-100 text-center primary-text mb-5">
          <i className="fas fa-power-off icon-xl"></i>
        </div>
        <div className="text-center">
          <h4 className="primary-text mb-4">{t('platform.linux.shutting_down_server')}</h4>
          {error
            ? <div className="alert alert-error my-4">{error}</div>
            : <p className="grey-text">{t('platform.linux.server_will_power_down')}</p>}
        </div>
      </div>
    </>
  )
}
