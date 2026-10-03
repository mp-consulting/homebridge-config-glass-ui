import type { InstalledPlugin } from '@/core/components/hb-v2-modal/hb-v2-readiness'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { HbV2ModalData } from '@/core/ui/modal-data'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { satisfies } from 'semver'

import { pluginsCache } from '@/core/caching/plugins-cache'
import { assessHbV2Readiness, DEFAULT_ICON } from '@/core/components/hb-v2-modal/hb-v2-readiness'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { toastApiError } from '@/core/utilities/http-error'
import { ws } from '@/core/ws'

export type HbV2ModalProps = HbV2ModalData & ModalComponentProps

/** The "ready for Homebridge v2?" modal (HbV2ModalComponent). */
export function HbV2Modal({ activeModal, isUpdating, skipIfCompatible }: HbV2ModalProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([])
  const [allPluginsSupported, setAllPluginsSupported] = useState(true)
  const [nodeReady, setNodeReady] = useState(false)
  // A plugin whose icon failed to load shows the Homebridge one instead
  const [brokenIcons, setBrokenIcons] = useState<Set<string>>(() => new Set())
  const activeModalRef = useRef(activeModal)
  activeModalRef.current = activeModal

  useEffect(() => {
    let cancelled = false

    async function checkHomebridgeUiVersion() {
      try {
        const io = ws.getExistingNamespace('status')!
        const { nodeVersion } = await io.request<{ nodeVersion: string }>('get-homebridge-server-info')
        if (!cancelled) {
          setNodeReady(satisfies(nodeVersion, '>=22'))
        }
      } catch (error: any) {
        console.error(error)
        toastApiError(error)
      }
    }

    async function loadInstalledPlugins() {
      const homebridgeVersion = useSettingsStore.getState().env.homebridgeVersion ?? ''
      try {
        const result = assessHbV2Readiness(await pluginsCache.get(), homebridgeVersion)
        if (cancelled) {
          return
        }
        setInstalledPlugins(result.installedPlugins)
        setAllPluginsSupported(result.allPluginsSupported)

        // Skip when every installed plugin declares v2 support (covers no plugins at all)
        if (skipIfCompatible && result.allPluginsSupported) {
          activeModalRef.current.close('update')
        }
      } catch (error) {
        console.error(error)
        toast.error(i18n.t('plugins.toast_failed_to_load_plugins'), i18n.t('toast.title_error'))
      }
    }

    void (async () => {
      // Asking a socket that is down would hang; the plugin list still loads
      if (ws.getExistingNamespace('status')?.socket.connected) {
        await checkHomebridgeUiVersion()
      }
      await loadInstalledPlugins()
      if (!cancelled) {
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [skipIfCompatible])

  const closeModal = (reason: string) => activeModal.close(reason)

  const closeButton = (
    <button
      type="button"
      className="btn btn-elegant"
      data-bs-dismiss="modal"
      aria-label={t('form.button_close')}
      onClick={() => closeModal('Dismiss')}
    >
      {t('form.button_close')}
    </button>
  )

  return (
    <div className="modal-content">
      <ModalHeader title={t('status.readiness.title', { app: 'Homebridge v2' })} onClose={() => closeModal('Dismiss')} />
      <div className="modal-body">
        {loading
          ? (
              <div className="w-100 text-center primary-text">
                <InlineSpinner className="icon-xl" />
              </div>
            )
          : (
              <>
                <div className="text-center mb-3">
                  <img src={DEFAULT_ICON} alt="" className="plugin-icon-card" height="100" width="100" />
                </div>
                {allPluginsSupported
                  ? <p className="text-center">All your plugins are marked as compatible with Homebridge v2.</p>
                  : (
                      <>
                        <p className="text-center">
                          Some of your plugins are not explicitly marked as compatible with Homebridge v2. This does
                          {' '}
                          <span className="fw-bold">not</span>
                          {' '}
                          necessarily mean that they won't work. We just can't guarantee that they will.
                        </p>
                        <p className="text-center">
                          For more information about this update, please see the
                          {' '}
                          <a href="https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0" target="_blank" rel="noopener noreferrer">wiki page</a>
                          .
                        </p>
                        {isUpdating && <p className="text-center">To ignore this warning and continue with the update, click continue below.</p>}
                      </>
                    )}
                <ul className="list-group list-group-box mb-0">
                  <li className="list-group-item d-flex justify-content-between align-items-center">
                    {nodeReady
                      ? (
                          <>
                            <div className="text-start flex-grow-1">
                              Node.js Version
                              <br />
                              <span className="grey-text">{t('status.readiness.node_yes', { app: 'Homebridge v2' })}</span>
                            </div>
                            <div className="ms-3">
                              <i className="fas fa-check-circle green-text fa-xl"></i>
                            </div>
                          </>
                        )
                      : (
                          <>
                            <div className="text-start flex-grow-1">
                              Node.js Version
                              <br />
                              <span className="grey-text">{t('status.readiness.node_no', { app: 'Homebridge v2' })}</span>
                              <br />
                              <a
                                href="https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="small"
                              >
                                {t('plugins.compat.node_link')}
                                {' '}
                                <i className="fas fa-up-right-from-square"></i>
                              </a>
                            </div>
                            <div className="ms-3">
                              <i className="fas fa-exclamation-circle orange-text fa-xl"></i>
                            </div>
                          </>
                        )}
                  </li>
                  {installedPlugins.map(plugin => (
                    <li key={plugin.name} className="list-group-item d-flex justify-content-between align-items-center">
                      <div className="me-3">
                        <img
                          alt=""
                          aria-hidden="true"
                          className="plugin-icon-small"
                          src={brokenIcons.has(plugin.name) ? DEFAULT_ICON : (plugin.icon as string | undefined)}
                          onError={() => setBrokenIcons(current => new Set(current).add(plugin.name))}
                        />
                      </div>
                      <div className="text-start flex-grow-1">{plugin.displayName as string}</div>
                      <div className="ms-3">
                        {plugin.hb2Ready === 'supported' && (
                          <i
                            className="fas fa-check-circle green-text fa-xl"
                            role="img"
                            aria-label={t('plugins.compat.hb2_supported')}
                          >
                          </i>
                        )}
                        {plugin.hb2Ready === 'unknown' && (
                          <i
                            className="fas fa-question-circle orange-text fa-xl"
                            role="img"
                            aria-label={t('plugins.compat.hb2_unknown')}
                          >
                          </i>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
      </div>
      <ModalFooter>
        <div className="text-start">{isUpdating && closeButton}</div>
        <div className="text-center">{!isUpdating && closeButton}</div>
        <div className="text-end">
          {isUpdating && (
            <button
              type="button"
              className="btn btn-primary"
              data-bs-dismiss="modal"
              disabled={loading}
              onClick={() => closeModal('update')}
            >
              {t('form.button_continue')}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
