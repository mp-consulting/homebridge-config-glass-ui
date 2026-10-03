import { useEffect } from 'react'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { Confirm } from '@/core/components/confirm/Confirm'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toastApiError } from '@/core/utilities/http-error'

/** The ways to restart: Homebridge, the hb-service, the host, the container. */
export function PowerOptions() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canShutdownRestartHost = useSettingsStore(state => state.env.canShutdownRestartHost)
  const runningInDocker = useSettingsStore(state => state.env.runningInDocker)

  useEffect(() => {
    // Set page title
    settingsActions.setPageTitle(i18n.t('menu.restart.title'))
  }, [])

  // The user is acting on the "restart required" reminder right now
  const closeRestartToast = () => settingsActions.clearRestartToast()

  const restartHomebridge = () => {
    closeRestartToast()
    void navigate('/restart')
  }

  const restartHomebridgeService = async () => {
    closeRestartToast()
    try {
      await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
      void navigate('/restart')
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
  }

  const restartServer = () => {
    closeRestartToast()
    void navigate('/platform-tools/linux/restart-server')
  }

  const shutdownServer = async () => {
    closeRestartToast()
    // Confirmation dialog
    const ref = openModal(Confirm, {
      title: i18n.t('menu.linux.label_shutdown_server'),
      message: i18n.t('menu.linux.label_shutdown_modal'),
      confirmButtonLabel: i18n.t('form.button_continue'),
      faIconClass: 'fas fa-power-off primary-text',
    }, {
      size: 'lg',
      backdrop: 'static',
    })

    try {
      await ref.result
      void navigate('/platform-tools/linux/shutdown-server')
    } catch {
      // Modal dismissed, do nothing
    }
  }

  const dockerRestartContainer = () => {
    closeRestartToast()
    void navigate('/platform-tools/docker/restart-container')
  }

  return (
    <>
      <div className="d-flex justify-content-between">
        <h3 className="primary-text m-0">{t('menu.restart.title')}</h3>
      </div>
      <div className="my-4 align-items-center container-narrow">
        <div className="w-100 text-center primary-text mb-5">
          <i className="fas fa-power-off icon-xl" aria-hidden="true"></i>
        </div>
        <p className="w-100 text-center my-5">
          <button type="button" className="btn btn-primary p-3 my-0 w-85" onClick={restartHomebridge}>
            {t('menu.hbrestart.confirm_hb')}
          </button>
        </p>
        <p className="w-100 text-center my-5">
          <OverlayTrigger
            trigger={['hover', 'focus']}
            delay={{ show: 150, hide: 0 }}
            overlay={<Tooltip id="power-options-force-restart-tooltip">{t('reset.force_restart_hb_help_text')}</Tooltip>}
          >
            <button type="button" className="btn btn-primary p-3 my-0 w-85" onClick={() => void restartHomebridgeService()}>
              {t('menu.hbrestart.confirm_ui')}
            </button>
          </OverlayTrigger>
        </p>
        {canShutdownRestartHost && (
          <p className="w-100 text-center my-5">
            <button type="button" className="btn btn-primary p-3 my-0 w-85" onClick={restartServer}>
              {t('menu.linux.label_restart_server')}
            </button>
          </p>
        )}
        {canShutdownRestartHost && (
          <p className="w-100 text-center my-5">
            <button type="button" className="btn btn-primary p-3 my-0 w-85" onClick={() => void shutdownServer()}>
              {t('menu.linux.label_shutdown_server')}
            </button>
          </p>
        )}
        {runningInDocker && (
          <p className="w-100 text-center my-5">
            <button type="button" className="btn btn-primary p-3 my-0 w-85" onClick={dockerRestartContainer}>
              {t('menu.docker.restart_container')}
            </button>
          </p>
        )}
      </div>
    </>
  )
}
