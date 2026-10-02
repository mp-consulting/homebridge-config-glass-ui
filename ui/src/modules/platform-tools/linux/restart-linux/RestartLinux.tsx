import { useTranslation } from 'react-i18next'

import { useHostRestart } from '@/modules/platform-tools/use-host-restart'

import '@/modules/platform-tools/restart-progress.scss'

/** Restarting the host machine: it takes a minute or more to come back. */
export function RestartLinux() {
  const { t } = useTranslation()
  const { error, timedOut } = useHostRestart({
    endpoint: '/platform-tools/linux/restart-host',
    settleMs: 30000,
    timeoutMs: 120000,
    successKey: 'platform.linux.server_restarted',
    errorKey: 'platform.linux.server_restart_error',
    timeoutKey: 'platform.linux.server_taking_long_time',
  })

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
          <h4 className="primary-text mb-4">{t('platform.linux.restarting_server')}</h4>
          {error
            ? <div className="alert alert-error my-4">{error}</div>
            : (
                <>
                  <p className="grey-text">{t('restart.please_wait_while_server_restarts')}</p>
                  <div className="justify-content-center my-4">
                    <div className="restart-progress-box primary-text">
                      <i className="fas fa-circle-notch fa-spin"></i>
                    </div>
                  </div>
                </>
              )}
          {timedOut && (
            <div className="alert alert-warning my-4">{t('platform.linux.long_time')}</div>
          )}
        </div>
      </div>
    </>
  )
}
