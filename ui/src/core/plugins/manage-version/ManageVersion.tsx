import type { HomebridgeUpdatePolicy } from '@/core/interfaces/settings.interfaces'
import type { VersionData } from '@/core/plugins/manage-plugins.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { ManageVersionModalData } from '@/core/ui/modal-data'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rcompare } from 'semver'

import { api } from '@/core/api'
import { pluginsCache } from '@/core/caching/plugins-cache'
import { getCurrentUpdatePreference } from '@/core/plugins/manage-version/update-preference'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'

import './manage-version.scss'

export type ManageVersionProps = ManageVersionModalData & ModalComponentProps

/** What the version modal closes with. */
export interface ManageVersionResult {
  name: string
  version: string
  engines?: VersionData['engines']
  action: 'alternate' | 'install'
}

const SELF_PACKAGES = ['homebridge', '@mp-consulting/homebridge-config-glass-ui']
const TAG_ORDER = ['latest', 'next', 'beta', 'alpha']

/** The version picker and update notification preference (ManageVersionComponent). */
export function ManageVersion({ activeModal, plugin, onRefreshPluginList, onSettingsChange }: ManageVersionProps) {
  const { t } = useTranslation()
  const [versionSelect, setVersionSelect] = useState<string>(() => plugin ? (plugin.installedVersion || plugin.latestVersion) : '')
  const [loading, setLoading] = useState(true)
  const [versions, setVersions] = useState<VersionData[]>([])
  const [versionsWithTags, setVersionsWithTags] = useState<Array<{ version: string, tag: string }>>([])
  const [updatePreference, setUpdatePreference] = useState<HomebridgeUpdatePolicy>(() => getCurrentUpdatePreference(plugin))
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef({ activeModal, onRefreshPluginList, onSettingsChange })
  latestRef.current = { activeModal, onRefreshPluginList, onSettingsChange }

  useEffect(() => {
    if (!plugin) {
      return undefined
    }
    let cancelled = false

    void (async () => {
      try {
        const result: { versions: { [key: string]: VersionData }, tags: { [key: string]: string } } = await api.get(`/plugins/lookup/${encodeURIComponent(plugin.name)}/versions`)
        if (cancelled) {
          return
        }
        const newVersions: VersionData[] = []
        const newVersionsWithTags: Array<{ version: string, tag: string }> = []

        for (const [version, data] of Object.entries(result.versions)) {
          newVersions.push({
            version,
            engines: data.engines || null,
          })

          // A version is not limited to just one tag, so we need to check all tags
          Object.keys(result.tags)
            .filter(key => result.tags[key] === version)
            .forEach((tag) => {
              newVersionsWithTags.push({ version, tag })
            })
        }

        // In the case the plugin has an installed version that is not in the versions list, add it
        if (plugin.installedVersion && !newVersions.some(x => x.version === plugin.installedVersion)) {
          newVersions.push({
            version: plugin.installedVersion,
            engines: plugin.engines || null,
          })
        }

        newVersions.sort((a, b) => rcompare(a.version, b.version))

        // Sort the versionsWithTags by tag, with ordering latest, next, beta, alpha, any other
        newVersionsWithTags.sort((a, b) => {
          const aOrder = !TAG_ORDER.includes(a.tag) ? 999 : TAG_ORDER.indexOf(a.tag)
          const bOrder = !TAG_ORDER.includes(b.tag) ? 999 : TAG_ORDER.indexOf(b.tag)
          return aOrder - bOrder
        })

        setVersions(newVersions)
        setVersionsWithTags(newVersionsWithTags)
        setVersionSelect(current => (!newVersions.some(x => x.version === current) && result.tags.latest) ? result.tags.latest : current)
        setLoading(false)
      } catch (error) {
        console.error(error)
        const message = error instanceof Error ? (error as any).error?.message || error.message : i18n.t('toast.title_error')
        toast.error(message, i18n.t('toast.title_error'))
        latestRef.current.activeModal.dismiss()
      }
    })()

    return () => {
      cancelled = true
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
    // The modal is opened for one plugin
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  function doInstall(selectedVersion: string): void {
    if (!plugin) {
      return
    }
    const selectedVersionData = versions.find(x => x.version === selectedVersion)
    activeModal.close({
      name: plugin.name,
      version: selectedVersion,
      engines: selectedVersionData?.engines,
      action: plugin.installedVersion ? 'alternate' : 'install',
    } satisfies ManageVersionResult)
  }

  async function savePreference(value: HomebridgeUpdatePolicy): Promise<void> {
    if (!plugin) {
      return
    }

    try {
      // Update based on package type
      if (plugin.name === 'homebridge') {
        await api.patch('/config-editor/ui', { homebridgeUpdatePolicy: value })
        settingsActions.setEnvItem('homebridgeUpdatePolicy', value)
        await api.post('/plugins/clear-cache', {})
      } else if (plugin.name === '@mp-consulting/homebridge-config-glass-ui') {
        await api.patch('/config-editor/ui', { homebridgeUiUpdatePolicy: value })
        settingsActions.setEnvItem('homebridgeUiUpdatePolicy', value)
        await api.post('/plugins/clear-cache', {})
      } else {
        // Regular plugins - use array-based preferences (no 'major' option)
        const { env } = useSettingsStore.getState()
        const hideUpdates = value === 'none'
        const preferBetas = value === 'beta'
        let hideList = env.plugins?.hideUpdatesFor || []
        if (hideUpdates && !hideList.includes(plugin.name)) {
          hideList = [...hideList, plugin.name].sort((a, b) => a.localeCompare(b))
        } else if (!hideUpdates) {
          hideList = hideList.filter(x => x !== plugin.name)
        }

        let betaList = env.plugins?.showBetasFor || []
        if (preferBetas && !betaList.includes(plugin.name)) {
          betaList = [...betaList, plugin.name].sort((a, b) => a.localeCompare(b))
        } else if (!preferBetas) {
          betaList = betaList.filter(x => x !== plugin.name)
        }

        await api.put('/config-editor/ui/plugins/hide-updates-for', {
          body: hideList,
        })
        await api.patch('/config-editor/ui', { 'plugins.showBetasFor': betaList })
        settingsActions.setEnvItem('plugins.hideUpdatesFor', hideList)
        settingsActions.setEnvItem('plugins.showBetasFor', betaList)

        // Clear cache for regular plugins too
        await api.post('/plugins/clear-cache', {})
      }

      // Server-side plugin metadata was cleared above, so drop the
      // frontend cache so the next /plugins call re-fetches.
      pluginsCache.invalidate()

      latestRef.current.onRefreshPluginList?.()
      latestRef.current.onSettingsChange?.()

      toast.success(i18n.t('config.config_saved'), i18n.t('toast.title_success'))
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : i18n.t('toast.title_error')
      toast.error(message, i18n.t('toast.title_error'))
      // Revert on error
      setUpdatePreference(getCurrentUpdatePreference(plugin))
    }
  }

  function onPreferenceChange(value: HomebridgeUpdatePolicy): void {
    setUpdatePreference(value)
    // Saved once the choice has settled for half a second (debounceTime(500))
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void savePreference(value)
    }, 500)
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  const installLabel = (version: string) => `${plugin?.installedVersion === version ? t('plugins.manage.reinstall') : t('plugins.manage.install')} v${version}`
  const installIcon = (version: string) => plugin?.installedVersion === version
    ? <i className="fas fa-rotate-right"></i>
    : <i className="fas fa-arrow-alt-circle-down"></i>

  const preferenceOption = (value: HomebridgeUpdatePolicy, icon: string, key: string) => (
    <li className="list-group-item text-start" key={value}>
      <label className="d-flex align-items-center w-100 mb-0 cursor-pointer">
        <input
          type="radio"
          name="updatePreference"
          value={value}
          className="visually-hidden"
          checked={updatePreference === value}
          aria-label={t(key)}
          onChange={() => onPreferenceChange(value)}
        />
        <div className="me-3">
          <i className={`${icon} fa-2x ${updatePreference === value ? 'primary-text' : 'grey-text'}`} aria-hidden="true"></i>
        </div>
        <div className="flex-grow-1">
          <div aria-hidden="true">{t(key)}</div>
          <small className="grey-text">{t(`${key}_desc`)}</small>
        </div>
        {updatePreference === value && (
          <div className="ms-3">
            <i className="fas fa-xl fa-check-circle primary-text" aria-hidden="true"></i>
          </div>
        )}
      </label>
    </li>
  )

  return (
    <div className="modal-content hb-manage-version">
      <div className="modal-header">
        <h5 className="modal-title">{plugin?.displayName || plugin?.name}</h5>
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="modal"
          aria-label={t('form.button_close')}
          onClick={dismissModal}
        >
        </button>
      </div>
      <div className="modal-body d-flex flex-row flex-grow-1 w-100">
        {loading
          ? (
              <div className="w-100 text-center primary-text my-5 w-100">
                <i className="fas fa-circle-notch fa-spin icon-xl"></i>
              </div>
            )
          : (
              <div className="w-100 text-center">
                {plugin?.installedVersion
                  ? (
                      <>
                        <i className="fas fa-code-compare primary-text mb-3 icon-xl"></i>
                        <h6 className="mb-3">{t('plugins.manage.select_version')}</h6>
                        <p className="mb-3">
                          {t('plugins.status_installed')}
                          :
                          {' '}
                          <span className="font-monospace">
                            v
                            {plugin.installedVersion}
                          </span>
                        </p>
                      </>
                    )
                  : (
                      <>
                        <i className="far fa-arrow-alt-circle-down primary-text mb-3 icon-xl"></i>
                        <h6 className="mb-3">{t('plugins.manage.select_version')}</h6>
                      </>
                    )}
                <ul className="list-group list-group-box mb-0">
                  {versionsWithTags.map(version => (
                    <li key={`${version.tag}-${version.version}`} className="list-group-item d-flex justify-content-between align-items-center">
                      <span className="text-start">
                        {version.tag}
                        <br />
                        <small className="grey-text font-monospace">
                          v
                          {version.version}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary m-0 ms-3 py-1"
                        aria-label={installLabel(version.version)}
                        onClick={() => doInstall(version.version)}
                      >
                        {installIcon(version.version)}
                      </button>
                    </li>
                  ))}
                  <li className="list-group-item d-flex justify-content-between align-items-center">
                    <div className="text-start min-w-50">
                      {t('plugins.manage.all_versions')}
                      <br />
                      <select
                        className="custom-select w-100 font-monospace version-select"
                        aria-label={t('plugins.manage.all_versions')}
                        value={versionSelect}
                        onChange={event => setVersionSelect(event.target.value)}
                      >
                        {versions.map(version => (
                          <option key={version.version} value={version.version}>
                            {`v${version.version}${version.version === plugin?.installedVersion ? ' ✓' : ''}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    {versionSelect && (
                      <button
                        type="button"
                        className="btn btn-primary m-0 ms-3 py-1"
                        aria-label={installLabel(versionSelect)}
                        onClick={() => doInstall(versionSelect)}
                      >
                        {installIcon(versionSelect)}
                      </button>
                    )}
                  </li>
                </ul>

                {plugin?.installedVersion && (
                  <ul
                    className="list-group list-group-box mt-3 mb-0"
                    role="radiogroup"
                    aria-label={t('plugins.manage.notifications')}
                  >
                    {preferenceOption('all', 'fas fa-bell', 'plugins.manage.notifications_all')}
                    {preferenceOption('beta', 'fas fa-vial', 'plugins.manage.notifications_beta')}
                    {SELF_PACKAGES.includes(plugin.name) && preferenceOption('major', 'far fa-bell', 'plugins.manage.notifications_major')}
                    {preferenceOption('none', 'fas fa-bell-slash', 'plugins.manage.notifications_none')}
                  </ul>
                )}
              </div>
            )}
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start"></div>
        <div className="text-center">
          <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-end"></div>
      </div>
    </div>
  )
}
