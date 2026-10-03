import { useTranslation } from 'react-i18next'

import { SafeHtml } from '@/core/ui/SafeHtml'
import { useHostRestart } from '@/modules/platform-tools/use-host-restart'

import '@/modules/platform-tools/restart-progress.scss'

const command = '<span class="font-monospace">--restart=always</span>'

/** Restarting the Docker container: a container is back in seconds. */
export function ContainerRestart() {
  const { t } = useTranslation()
  const { error, timedOut } = useHostRestart({
    endpoint: '/platform-tools/docker/restart-container',
    settleMs: 10000,
    timeoutMs: 60000,
    successKey: 'platform.docker.container_restarted',
    errorKey: 'restart.toast_server_restart_error',
    timeoutKey: 'restart.toast_server_restart_timeout',
  })

  return (
    <>
      <div className="d-flex justify-content-between">
        <h3 className="primary-text m-0">{t('menu.restart.title')}</h3>
      </div>

      <div className="my-4 align-items-center container-narrow">
        <div className="w-100 text-center primary-text mb-5">
          <i className="fab fa-docker icon-xl"></i>
        </div>
        <div className="text-center">
          <h4 className="primary-text mb-4">{t('platform.docker.title_restarting')}</h4>
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
            <div className="alert alert-warning my-4">
              <p>{t('platform.docker.server_long_time')}</p>
              <SafeHtml as="p" className="grey-text mb-0" html={t('platform.docker.run_with_restart', { command })} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
