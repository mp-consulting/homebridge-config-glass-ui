import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { UninstallPluginModalData } from '@/core/ui/modal-data'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { ManagePlugin } from '@/core/plugins/manage-plugin/ManagePlugin'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { toast } from '@/core/ui/toast'

import './uninstall-plugin.scss'

const RE_COLON = /:/g

export type UninstallPluginProps = UninstallPluginModalData & ModalComponentProps

/**
 * "Uninstall this plugin?" - gathers what to clean up (its config, its child
 * bridge pairings), does that, then hands over to ManagePlugin for the npm part.
 */
export function UninstallPlugin({
  activeModal,
  plugin,
  childBridges: childBridgesProp,
  keepOrphans = false,
  onRefreshPluginList = () => {},
  editorContext,
}: UninstallPluginProps) {
  const { t } = useTranslation()
  const childBridges: ChildBridge[] = childBridgesProp ?? []

  const [loading, setLoading] = useState(true)
  const [uninstalling, setUninstalling] = useState(false)
  const [removeConfig, setRemoveConfig] = useState(true)
  const [removeChildBridges, setRemoveChildBridges] = useState(true)
  const [hasChildBridges, setHasChildBridges] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const [isConfiguredDynamicPlatform, setIsConfiguredDynamicPlatform] = useState(false)
  const [pluginType, setPluginType] = useState<'platform' | 'accessory' | null>(null)
  const [pluginAlias, setPluginAlias] = useState<string | null>(null)
  const [keepOrphansValue, setKeepOrphansValue] = useState('<code>false</code>')

  const keepOrphansName = `<code>${t('settings.startup.keep_accessories')}</code>`

  useEffect(() => {
    if (!plugin) {
      return
    }
    let cancelled = false
    const initialize = async () => {
      try {
        setIsConfigured(plugin.isConfigured)
        if (childBridges.length) {
          setHasChildBridges(true)
        }

        const schema = await (editorContext?.alias
          ?? api.get<any>(`/plugins/alias/${encodeURIComponent(plugin.name)}`))
        if (cancelled) {
          return
        }
        setPluginType(schema.pluginType)
        setPluginAlias(schema.pluginAlias)

        // Check if this is a dynamic platform
        const dynamic = schema.pluginType === 'platform' && Boolean(schema.pluginAlias)
        if (dynamic) {
          setIsConfiguredDynamicPlatform(true)
        }

        setKeepOrphansValue(`<code>${keepOrphans}</code>`)

        // When keepOrphans=true and dynamic platform, default to NOT removing config (keeping accessories)
        const nextRemoveConfig = !(keepOrphans && dynamic)
        setRemoveConfig(nextRemoveConfig)

        // Always sync removeChildBridges with removeConfig on init
        setRemoveChildBridges(nextRemoveConfig)
      } catch (error) {
        console.error('Failed to initialize:', error)
        const message = error instanceof Error ? error.message : 'Failed to load plugin information'
        toast.error(message, i18n.t('toast.title_error'))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void initialize()
    return () => {
      cancelled = true
    }
    // Loaded once, when the modal opens
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  // For dynamic platforms with keepOrphans=true, show override message when removing config
  const settingTranslationKey = isConfiguredDynamicPlatform && keepOrphans && removeConfig
    ? 'plugins.manage.confirm_disable_setting_override'
    : 'plugins.manage.confirm_disable_setting'

  // Accessories kept in cache only when: keepOrphans=true, dynamic platform, and NOT removing config
  const willKeepAccessoriesInCache = keepOrphans && isConfiguredDynamicPlatform && !removeConfig

  // Only show cleanup alert if accessories are being removed from cache
  const shouldShowCleanupAlert = !willKeepAccessoriesInCache

  const removePluginConfig = async () => {
    // Remove the config for this plugin
    await api.post(`/config-editor/plugin/${encodeURIComponent(plugin.name)}`, [])

    // If the plugin is in the disabled list, then remove it
    await api.put(`/config-editor/plugin/${encodeURIComponent(plugin.name)}/enable`, {})

    toast.success(t('plugins.settings.plugin_config_saved'), t('toast.title_success'))
  }

  const removeChildBridge = async (id: string) => {
    try {
      await api.delete(`/server/pairings/${id}`)
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : 'Failed to remove child bridge'
      toast.error(message, t('toast.title_error'))
    }
  }

  const doUninstall = async () => {
    setUninstalling(true)

    // Remove the plugin config if exists and specified by the user
    if (removeConfig && isConfigured) {
      try {
        await removePluginConfig()
      } catch (error) {
        console.error(error)
        const message = error instanceof Error ? error.message : 'Unknown error'
        toast.error(message, t('toast.title_error'))
      }
    }

    // Remove the child bridges if exists and specified by the user
    if (hasChildBridges && removeChildBridges) {
      try {
        await Promise.all(childBridges.map(childBridge => removeChildBridge(childBridge.username.replace(RE_COLON, ''))))
      } catch (error) {
        console.error(error)
      }
    }

    // Close the modal
    activeModal.dismiss()

    // Open a new modal to finally uninstall the plugin
    if (!plugin) {
      return
    }

    openModal(ManagePlugin, {
      action: 'Uninstall',
      pluginName: plugin.name,
      pluginDisplayName: plugin.displayName,
      onRefreshPluginList,
    }, {
      size: 'lg',
      backdrop: 'static',
    })
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  const onRemoveConfigChange = (checked: boolean) => {
    setRemoveConfig(checked)
    // Always sync removeChildBridges with removeConfig since they go hand-in-hand
    setRemoveChildBridges(checked)
  }

  return (
    <div className="modal-content modal-min-height">
      <div className="modal-header">
        <h5 className="modal-title">{plugin?.displayName || plugin?.name}</h5>
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="modal"
          aria-label={t('form.button_close')}
          disabled={uninstalling}
          onClick={dismissModal}
        >
        </button>
      </div>
      <div className="modal-body">
        {loading
          ? (
              <div className="text-center primary-text my-5 w-100">
                <i className="fas fa-circle-notch fa-spin icon-xl" aria-hidden="true"></i>
              </div>
            )
          : (
              <>
                <div className="text-center mb-0">
                  <i className="fas fa-trash primary-text icon-xl" aria-hidden="true"></i>
                </div>
                {isConfigured && pluginAlias && pluginType && (
                  <>
                    <div className="text-center mt-4 mb-0">
                      <p className="d-inline-block text-start mb-0">
                        <label className="hb-uix-switch d-block" htmlFor="remove-plugin-config">
                          <input
                            id="remove-plugin-config"
                            type="checkbox"
                            checked={removeConfig}
                            onChange={event => onRemoveConfigChange(event.target.checked)}
                          />
                          {t('plugins.uninstall_remove_plugin_config')}
                          <span className="hb-uix-slider hb-uix-round"></span>
                        </label>
                      </p>
                    </div>
                    {isConfiguredDynamicPlatform && (
                      <>
                        <ul className="mt-2 text-start">
                          <SafeHtml as="li" html={t(settingTranslationKey, { setting: keepOrphansName, value: keepOrphansValue })} />
                          <ul className="mb-0">
                            {willKeepAccessoriesInCache
                              ? (
                                  <>
                                    <li>{t('plugins.manage.confirm_disable_platform_1')}</li>
                                    <li>{t('plugins.manage.confirm_disable_platform_2')}</li>
                                  </>
                                )
                              : (
                                  <>
                                    <li>{t('plugins.manage.confirm_disable_accessory_1')}</li>
                                    <li>{t('plugins.manage.confirm_disable_accessory_2')}</li>
                                  </>
                                )}
                          </ul>
                        </ul>
                        {shouldShowCleanupAlert && (
                          <div role="alert" className="mt-4 alert show alert-info fade">
                            {hasChildBridges ? t('plugins.uninstall_cleanup_child_bridge') : t('plugins.uninstall_cleanup_main_bridge')}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
                {isConfigured && (!pluginAlias || !pluginType) && (
                  <div role="alert" className="mt-4 alert show alert-info fade">
                    {t('plugins.uninstall_remove_config_required')}
                  </div>
                )}
                <div role="alert" className="mt-4 mb-0 alert show alert-warning fade">
                  <p className="mb-0">
                    {t('plugins.uninstall_remove_confirmation', { pluginName: plugin?.displayName })}
                  </p>
                </div>
              </>
            )}
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            disabled={uninstalling}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button
            type="button"
            className="btn btn-danger"
            data-bs-dismiss="modal"
            disabled={loading || uninstalling}
            onClick={() => void doUninstall()}
          >
            {!uninstalling
              ? t('plugins.manage.uninstall')
              : <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>}
          </button>
        </div>
      </div>
    </div>
  )
}
