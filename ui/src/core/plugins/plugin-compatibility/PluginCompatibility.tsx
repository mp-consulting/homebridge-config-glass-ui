import type { ModalComponentProps } from '@/core/ui/modal'
import type { PluginCompatibilityModalData } from '@/core/ui/modal-data'

import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { minVersion } from 'semver'

import { useSettingsStore } from '@/core/settings'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'

import './plugin-compatibility.scss'

export type PluginCompatibilityProps = PluginCompatibilityModalData & ModalComponentProps

/**
 * semver's minVersion, but null for a missing / unparsable range. Angular's
 * ngOnInit threw there and still rendered; a throw in a React render would
 * take the whole modal host down instead.
 */
function safeMinVersion(range: string | undefined): string | undefined {
  try {
    return minVersion(range as string)?.version
  } catch {
    return undefined
  }
}

const SELF_PACKAGES = ['homebridge', '@mp-consulting/homebridge-config-glass-ui']

/** "This plugin needs a newer Node.js / Homebridge - continue anyway?" */
export function PluginCompatibility({
  activeModal,
  plugin,
  isValidNode = false,
  isValidHb = false,
  action = null,
}: PluginCompatibilityProps) {
  const { t } = useTranslation()
  const nodeInstalledVersion = useSettingsStore(state => state.env.nodeVersion)
  const hbInstalledVersion = useSettingsStore(state => state.env.homebridgeVersion)

  useEffect(() => {
    if (!plugin) {
      console.error('PluginCompatibilityComponent: plugin not provided')
      activeModal.dismiss('Missing required data')
    }
  }, [plugin, activeModal])

  const nodeMinVersion = useMemo(() => (plugin ? safeMinVersion(plugin.updateEngines?.node) : undefined), [plugin])
  const hbMinVersion = useMemo(() => (plugin ? safeMinVersion(plugin.updateEngines?.homebridge) : undefined), [plugin])

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const closeModal = () => activeModal.close(true)

  const isOther = plugin && !SELF_PACKAGES.includes(plugin.name)
  const isSelf = plugin && SELF_PACKAGES.includes(plugin.name)

  const nodeTooLow = (packageName: string) => (
    <>
      <div className="text-center mb-3">
        <i className="fab fa-node-js primary-text icon-xl" aria-hidden="true"></i>
      </div>
      <ul className="list-group list-group-box mb-3 text-start">
        <li className="list-group-item d-flex justify-content-between align-items-center">
          <div className="me-3">
            <i className="fas fa-exclamation-circle orange-text fa-xl" aria-hidden="true"></i>
          </div>
          <div className="text-start flex-grow-1">
            {t('plugins.compat.hb_node_too_low', {
              minVersion: nodeMinVersion,
              installedVersion: nodeInstalledVersion,
              latestVersion: plugin.latestVersion,
              packageName,
            })}
          </div>
        </li>
      </ul>
      {/* <ngb-alert type="warning" [dismissible]="false"> */}
      <div role="alert" className="mb-0 alert show alert-warning fade">
        <p className="text-center mb-1">{t('plugins.compat.node_first', { packageName })}</p>
        <p className="text-center mb-0">
          <a href="https://homebridge.io/w/JTKEF" target="_blank" rel="noopener noreferrer">
            {t('plugins.compat.node_link')}
            {' '}
            <i className="fas fa-up-right-from-square" aria-hidden="true"></i>
          </a>
        </p>
      </div>
    </>
  )

  return (
    <div className="modal-content modal-min-height">
      <ModalHeader title={t('plugins.compat.title')} onClose={dismissModal} />
      <div className="modal-body">
        {/* plugins */}
        {isOther && (
          <>
            <div className="text-center mb-3">
              <i
                aria-hidden="true"
                className={`${
                  action === 'install'
                    ? 'far fa-arrow-alt-circle-down'
                    : action === 'update'
                      ? 'far fa-arrow-alt-circle-up'
                      : 'fas fa-code-compare'
                } primary-text icon-xl`}
              >
              </i>
            </div>
            <ul className="list-group list-group-box mb-3 text-start">
              {!isValidNode && (
                <li className="list-group-item d-flex justify-content-between align-items-center">
                  <div className="me-3">
                    <i className="fas fa-exclamation-circle orange-text fa-xl" aria-hidden="true"></i>
                  </div>
                  <div className="text-start flex-grow-1">
                    {t('plugins.compat.node_too_low', {
                      pluginName: plugin.displayName,
                      minVersion: nodeMinVersion,
                      installedVersion: nodeInstalledVersion,
                    })}
                  </div>
                </li>
              )}
              {!isValidHb && (
                <li className="list-group-item d-flex justify-content-between align-items-center">
                  <div className="me-3">
                    <i className="fas fa-exclamation-circle orange-text fa-xl" aria-hidden="true"></i>
                  </div>
                  <div className="text-start flex-grow-1">
                    {t('plugins.compat.hb_too_low', {
                      pluginName: plugin.displayName,
                      minVersion: hbMinVersion,
                      installedVersion: hbInstalledVersion,
                    })}
                  </div>
                </li>
              )}
            </ul>
            <div role="alert" className="mb-0 alert show alert-warning fade">
              <p className="text-center mb-0">{t('common.phrases.are_you_sure')}</p>
            </div>
          </>
        )}

        {/* homebridge */}
        {plugin && plugin.name === 'homebridge' && nodeTooLow('Homebridge')}

        {/* homebridge ui */}
        {plugin && plugin.name === '@mp-consulting/homebridge-config-glass-ui' && nodeTooLow('Homebridge Glass UI')}
      </div>
      <ModalFooter>
        <div className="text-start">
          {isOther && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-center">
          {isSelf && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-end">
          {isOther && (
            <button type="button" className="btn btn-danger" data-bs-dismiss="modal" onClick={closeModal}>
              {t('form.button_continue')}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
