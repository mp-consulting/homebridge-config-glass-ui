import type { NodeUpdatePolicy } from '@/core/interfaces/settings.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { NodeVersionModalData } from '@/core/ui/modal-data'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { satisfies } from 'semver'

import { api } from '@/core/api'
import { pluginsCache } from '@/core/caching'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { useDebouncedCallback } from '@/core/utilities/debounce'

export interface PluginNodeCheck {
  displayName: string
  name: string
  isSupported: string
  isSupportedStr: string
  icon: string
}

export type NodeVersionModalProps = NodeVersionModalData & ModalComponentProps

const defaultIcon = 'assets/hb-icon.png'

const POLICIES: Array<{ value: NodeUpdatePolicy, icon: string }> = [
  { value: 'all', icon: 'fas fa-bell' },
  { value: 'major', icon: 'far fa-bell' },
  { value: 'none', icon: 'far fa-bell-slash' },
]

/**
 * Check every installed plugin (and Homebridge itself) against a node version.
 * @param latestVersion - the node version to check against
 * @param homebridgePkg - the homebridge package, for its own engines range
 */
async function loadInstalledPlugins(latestVersion: string, homebridgePkg: NodeVersionModalData['homebridgePkg']): Promise<PluginNodeCheck[]> {
  const installedPlugins = await pluginsCache.get()
  const processedPlugins = installedPlugins
    .map((x: any) => {
      const isSupported = x.engines?.node
        ? (satisfies(latestVersion, x.engines.node, { includePrerelease: true }) ? 'yes' : 'no')
        : 'unknown'

      return {
        displayName: x.displayName || x.name,
        name: x.name,
        isSupported,
        isSupportedStr: `status.widget.update_node_${isSupported}`,
        icon: x.icon || defaultIcon,
      } as PluginNodeCheck
    })
    .sort((a: PluginNodeCheck, b: PluginNodeCheck) => {
      if (a.name === '@mp-consulting/homebridge-config-glass-ui') {
        return -1
      }
      if (b.name === '@mp-consulting/homebridge-config-glass-ui') {
        return 1
      }
      return a.name.localeCompare(b.name)
    })

  // Insert an item for Homebridge at the beginning of the list
  const hbIsSupported = satisfies(latestVersion, homebridgePkg.engines!.node!, { includePrerelease: true })
    ? 'yes'
    : 'no'
  processedPlugins.unshift({
    displayName: 'Homebridge',
    name: 'homebridge',
    isSupported: hbIsSupported,
    isSupportedStr: `status.widget.update_node_${hbIsSupported}`,
    icon: defaultIcon,
  })
  return processedPlugins
}

export function NodeVersionModal(props: NodeVersionModalProps) {
  const {
    activeModal,
    nodeVersion,
    latestVersion,
    showNodeUnsupportedWarning,
    homebridgeRunningInSynologyPackage,
    homebridgeRunningInDocker,
    homebridgePkg,
    architecture,
    supportsNodeJs24,
  } = props
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [installedPlugins, setInstalledPlugins] = useState<PluginNodeCheck[]>([])
  const [hasNode24OrAbove] = useState(() => satisfies(nodeVersion, '>=24.0.0', { includePrerelease: true }))
  const [nodeUpdatePolicy, setNodeUpdatePolicy] = useState<NodeUpdatePolicy>(() => useSettingsStore.getState().env.nodeUpdatePolicy || 'all')

  const latestPropsRef = useRef(props)
  latestPropsRef.current = props

  useEffect(() => {
    let active = true
    loadInstalledPlugins(latestVersion, homebridgePkg)
      .then((plugins) => {
        if (active) {
          setInstalledPlugins(plugins)
        }
      })
      .catch((error) => {
        console.error(error)
        toast.error(i18n.t('plugins.toast_failed_to_load_plugins'), i18n.t('toast.title_error'))
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [latestVersion, homebridgePkg])

  const updateNodeUpdatePolicy = async (value: NodeUpdatePolicy): Promise<void> => {
    const { statusIo, onUpdate } = latestPropsRef.current
    try {
      await api.patch('/config-editor/ui', { nodeUpdatePolicy: value })

      // Update the local settings cache
      settingsActions.setEnvItem('nodeUpdatePolicy', value)

      // Clear the backend cache so the new policy is applied, or the widget
      // goes on offering the version the OLD policy chose
      if (statusIo) {
        await statusIo.request('clear-nodejs-version-cache')
      }

      // Call the onUpdate callback if provided to refresh the widget
      if (onUpdate) {
        await onUpdate()
      }

      toast.success(i18n.t('config.config_saved'), i18n.t('toast.title_success'))
    } catch (error) {
      console.error(error)
      toast.error(i18n.t('config.toast_failed_to_save_config'), i18n.t('toast.title_error'))
      // Revert the choice on error (without saving it again)
      setNodeUpdatePolicy(useSettingsStore.getState().env.nodeUpdatePolicy || 'all')
    }
  }

  // The control's valueChanges pipe: debounceTime(500) + distinctUntilChanged
  const lastEmittedRef = useRef<NodeUpdatePolicy | undefined>(undefined)
  const policyChanged = useDebouncedCallback((value: NodeUpdatePolicy) => {
    if (value === lastEmittedRef.current) {
      return
    }
    lastEmittedRef.current = value
    void updateNodeUpdatePolicy(value)
  }, 500)

  const choosePolicy = (value: NodeUpdatePolicy) => {
    setNodeUpdatePolicy(value)
    policyChanged(value)
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  const handleIconError = (plugin: PluginNodeCheck) => {
    setInstalledPlugins(plugins => plugins.map(p => (p === plugin ? { ...p, icon: defaultIcon } : p)))
  }

  return (
    <div className="modal-content">
      <ModalHeader title="Node.js" onClose={dismissModal} />
      <div className="modal-body">
        {loading
          ? (
              <div className="w-100 text-center primary-text text-center">
                <i className="fas fa-circle-notch fa-spin icon-xl" aria-hidden="true"></i>
              </div>
            )
          : (
              <>
                <div className="text-center">
                  <i className="fas fab fa-node-js primary-text mb-3 icon-xl" aria-hidden="true"></i>
                  <h5 className="mb-3">
                    {nodeVersion}
                    {latestVersion !== nodeVersion && <>{` → ${latestVersion}`}</>}
                  </h5>
                </div>
                <ul className="mb-0">
                  <li>{t('status.widget.info.node_update_message')}</li>
                  {(homebridgeRunningInSynologyPackage || homebridgeRunningInDocker) && (
                    <li>{t('status.widget.info.node_update_message_2')}</li>
                  )}
                  {showNodeUnsupportedWarning && <li>{t('status.widget.info.node_unsupp_message')}</li>}
                </ul>
                <ul
                  className="list-group list-group-box mt-3 mb-0"
                  role="radiogroup"
                  aria-label={t('plugins.manage.notifications')}
                >
                  <div className="list-group-item text-center" aria-hidden="true">
                    {t('plugins.manage.notifications')}
                  </div>
                  {POLICIES.map(({ value, icon }) => (
                    <li key={value} className="list-group-item text-start">
                      <label className="d-flex align-items-center w-100 mb-0 cursor-pointer">
                        <input
                          type="radio"
                          name="nodeUpdatePolicy"
                          value={value}
                          className="visually-hidden"
                          checked={nodeUpdatePolicy === value}
                          aria-label={t(`plugins.manage.notifications_${value}`)}
                          onChange={() => choosePolicy(value)}
                        />
                        <div className="me-3">
                          <i
                            className={`${icon} fa-2x ${nodeUpdatePolicy === value ? 'primary-text' : 'grey-text'}`}
                            aria-hidden="true"
                          >
                          </i>
                        </div>
                        <div className="flex-grow-1">
                          <div aria-hidden="true">{t(`plugins.manage.notifications_${value}`)}</div>
                          <small className="grey-text">{t(`plugins.manage.notifications_${value}_desc`)}</small>
                        </div>
                        {nodeUpdatePolicy === value && (
                          <div className="ms-3">
                            <i className="fas fa-xl fa-check-circle primary-text" aria-hidden="true"></i>
                          </div>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
                {!hasNode24OrAbove && (
                  <ul className="list-group list-group-box mt-3 mb-0">
                    <li className="list-group-item text-center">{t('status.widget.info.node_major')}</li>
                    <li className="list-group-item d-flex justify-content-between align-items-center">
                      <div className="text-start flex-grow-1">
                        Node.js v24
                        <br />
                        <span className="grey-text small">
                          {t(supportsNodeJs24 ? 'status.widget.info.node_next_yes' : 'status.widget.info.node_next_no', { architecture })}
                        </span>
                      </div>
                      <div className="ms-3">
                        {supportsNodeJs24
                          ? <i className="fas fa-check-circle green-text fa-xl" aria-hidden="true"></i>
                          : <i className="fas fa-xmark-circle red-text fa-xl" aria-hidden="true"></i>}
                      </div>
                    </li>
                  </ul>
                )}
                {installedPlugins.length > 0 && (
                  <ul className="list-group list-group-box mt-3 mb-0">
                    <li className="list-group-item text-center">{t('menu.label_plugins')}</li>
                    {installedPlugins.map(plugin => (
                      <li key={plugin.name} className="list-group-item d-flex justify-content-between align-items-center">
                        <div className="me-3">
                          <img
                            alt=""
                            aria-hidden="true"
                            className="plugin-icon-small"
                            src={plugin.icon}
                            onError={() => handleIconError(plugin)}
                          />
                        </div>
                        <div className="text-start flex-grow-1">
                          {plugin.displayName}
                          <br />
                          <span className="grey-text small">
                            {t(plugin.isSupportedStr, { pluginName: plugin.displayName, nodeVersion: latestVersion })}
                          </span>
                        </div>
                        <div className="ms-3">
                          {plugin.isSupported === 'yes'
                            ? <i className="fas fa-check-circle green-text fa-xl" aria-hidden="true"></i>
                            : plugin.isSupported === 'no'
                              ? <i className="fas fa-xmark-circle red-text fa-xl" aria-hidden="true"></i>
                              : <i className="fas fa-question-circle orange-text fa-xl" aria-hidden="true"></i>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
      </div>
      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <a
            className="btn btn-primary text-decoration-none"
            target="_blank"
            href="https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js"
            rel="noopener noreferrer"
          >
            {t('form.button_more_info')}
            {' '}
            <i className="fas fa-external-link-alt" aria-hidden="true"></i>
          </a>
        </div>
      </ModalFooter>
    </div>
  )
}
