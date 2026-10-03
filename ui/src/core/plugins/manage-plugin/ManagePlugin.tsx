import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'
import type { ModalComponentProps, ModalRef } from '@/core/ui/modal'
import type { ManagePluginModalData } from '@/core/ui/modal-data'
import type { OwnedIoNamespace } from '@/core/ws'
import type { Terminal } from '@xterm/xterm'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { backupService } from '@/core/backup/backup.service'
import { pluginsCache } from '@/core/caching/plugins-cache'
import { HbV2Modal } from '@/core/components/hb-v2-modal/HbV2Modal'
import { Markdown } from '@/core/components/markdown/Markdown'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { determineSupportMessage, SELF_PACKAGES } from '@/core/plugins/manage-plugin/support-message'
import { ManageVersion } from '@/core/plugins/manage-version/ManageVersion'
import { PluginLogs } from '@/core/plugins/plugin-logs/PluginLogs'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { toast } from '@/core/ui/toast'
import { childBridges as childBridgesService } from '@/core/utilities/child-bridges'
import { cx } from '@/core/utilities/cx'
import { fileSaver } from '@/core/utilities/file-saver'
import { toastApiError } from '@/core/utilities/http-error'
import { xtermFactory } from '@/core/utilities/terminal/terminal.factory'
import { ws } from '@/core/ws'

import './manage-plugin.scss'

// eslint-disable-next-line no-control-regex
const RE_ANSI = /\x1B\[(\d{1,3}(;\d{1,2})?)?[mGK]/g
const RE_STARTS_WITH_DIGIT = /^\d/

const ICONS = {
  iconStar: '<i class="fas fa-star orange-text"></i>',
  iconThumbsUp: '<i class="fas fa-thumbs-up orange-text"></i>',
  iconCoffee: '<i class="fas fa-coffee pink-text"></i>',
  iconHeart: '<i class="fas fa-heart pink-text"></i>',
}

const open = openModal as (component: unknown, props: Record<string, any>, options?: Record<string, any>) => ModalRef

export type ManagePluginProps = ManagePluginModalData & ModalComponentProps

/**
 * The one modal in the app that runs npm: install, uninstall and update, with
 * the live npm output in an xterm (ManagePluginComponent).
 */
export function ManagePlugin(props: ManagePluginProps) {
  const { activeModal, pluginName, action } = props
  const pluginDisplayName = props.pluginDisplayName ?? ''
  const targetVersion = props.targetVersion ?? ''
  const latestVersion = props.latestVersion ?? ''
  const installedVersion = props.installedVersion ?? ''
  const isDisabled = props.isDisabled ?? false
  const initialIsConfigured = props.isConfigured ?? false
  const onRefreshPluginList = props.onRefreshPluginList ?? (() => {})
  const verifiedPlugin = props.verifiedPlugin ?? false
  const verifiedPlusPlugin = props.verifiedPlusPlugin ?? false
  const funding = props.funding ?? null
  const backToVersionModal = props.backToVersionModal ?? null

  const { t } = useTranslation()
  const navigate = useNavigate()
  const platform = useSettingsStore(state => state.env.platform)
  const isLightTerminalTheme = useSettingsStore(() => settingsActions.getEffectiveTerminalLightingMode()) === 'light'

  const onlineUpdateOk = !(SELF_PACKAGES.includes(pluginName) && platform === 'win32')

  const [targetVersionPretty, setTargetVersionPretty] = useState(() => targetVersion === 'latest'
    ? `v${latestVersion}`
    : (RE_STARTS_WITH_DIGIT.test(targetVersion) ? `v${targetVersion}` : targetVersion))
  const [actionComplete, setActionComplete] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
  const [justUpdatedPlugin, setJustUpdatedPlugin] = useState(false)
  const [childBridges, setChildBridges] = useState<ChildBridge[]>([])
  const [versionNotes, setVersionNotes] = useState('')
  const [versionNotesLoaded, setVersionNotesLoaded] = useState(false)
  const [versionNotesShow, setVersionNotesShow] = useState(false)
  const [fullChangelog, setFullChangelog] = useState('')
  const [fullChangelogLoaded, setFullChangelogLoaded] = useState(false)
  // getVersionNotes() showed the release notes as soon as an update opened
  const [releaseNotesShow, setReleaseNotesShow] = useState(action === 'Update')
  const [{ supportMessageKey, donationLink }] = useState(() => determineSupportMessage(pluginName, verifiedPlugin || verifiedPlusPlugin, funding))
  const [downloadingBackup, setDownloadingBackup] = useState(false)
  const [releaseNotesTab, setReleaseNotesTab] = useState(1)

  // Curated screen-reader announcements for the install/uninstall/update flow.
  // The xterm output is too noisy for SRs (per-line live region with ANSI noise),
  // so we mute it briefly with terminalAriaHidden while we announce the action.
  const [actionLiveMessage, setActionLiveMessage] = useState('')
  const [terminalAriaHidden, setTerminalAriaHidden] = useState(false)

  const termTargetRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const ioRef = useRef<OwnedIoNamespace | null>(null)
  const errorLogRef = useRef('')
  const restoreTerminalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmountedRef = useRef(false)

  // The past-tense verb, as Angular set it in ngOnInit (the present-tense one
  // it also set was never shown)
  const pastTenseKey = action === 'Install'
    ? (targetVersion === installedVersion ? 'plugins.manage.reinstalled' : 'plugins.manage.installed')
    : action === 'Uninstall'
      ? 'plugins.manage.uninstalled'
      : action === 'Update' ? 'plugins.manage.updated' : ''
  const pastTenseVerb = pastTenseKey ? t(pastTenseKey) : ''

  // Everything below runs from socket and timer callbacks, so it reads the
  // values it needs from this ref rather than from a stale render
  const liveRef = useRef({ pastTenseVerb, onlineUpdateOk })
  liveRef.current = { pastTenseVerb, onlineUpdateOk }

  const term = () => termRef.current!
  const io = () => ioRef.current!

  const toastSuccess = () => i18n.t('toast.title_success')

  function speakAction(messageKey: string, suppressTerminalMs = 2000): void {
    setTerminalAriaHidden(true)
    // Clear-then-set so consecutive messages re-trigger the aria-live announcement
    setActionLiveMessage('')
    setTimeout(() => {
      if (!unmountedRef.current) {
        setActionLiveMessage(i18n.t(messageKey, { pluginName: pluginDisplayName || pluginName }))
      }
    }, 0)

    if (restoreTerminalTimerRef.current) {
      clearTimeout(restoreTerminalTimerRef.current)
    }
    restoreTerminalTimerRef.current = setTimeout(() => {
      setTerminalAriaHidden(false)
    }, suppressTerminalMs)
  }

  function applyXtermA11yPatches(): void {
    const host = termTargetRef.current
    if (!host) {
      return
    }

    const xtermRoot = host.querySelector('.xterm') as HTMLElement | null
    if (!xtermRoot) {
      return
    }

    // The xterm textarea is for stdin which this terminal does not use
    const ta = xtermRoot.querySelector('textarea')
    if (ta) {
      // Blur first: a disabled element can no longer be blurred
      if (document.activeElement === ta) {
        ta.blur()
      }
      ta.disabled = true
      ta.setAttribute('aria-hidden', 'true')
      ta.setAttribute('tabindex', '-1')
      ta.setAttribute('readonly', 'true')
    }

    // Silence xterm's per-line live region — speakAction() drives announcements instead
    for (const el of Array.from(xtermRoot.querySelectorAll<HTMLElement>('[aria-live]'))) {
      el.setAttribute('aria-live', 'off')
      el.setAttribute('aria-atomic', 'false')
    }
  }

  function closeModal(result?: unknown): void {
    activeModal.close(result)
  }

  function install(): void {
    if (!liveRef.current.onlineUpdateOk) {
      return
    }

    if (pluginName === 'homebridge') {
      void upgradeHomebridge()
      return
    }

    io().request('install', {
      name: pluginName,
      version: targetVersion,
      termCols: term().cols,
      termRows: term().rows,
    }).then(async () => {
      speakAction('plugins.a11y.installed_restart', 3000)
      toast.success(i18n.t('plugins.manage.toast_success', { verb: liveRef.current.pastTenseVerb, name: pluginName }), toastSuccess())

      // Invalidate caches BEFORE notifying the plugins page — otherwise its
      // loadInstalledPlugins() reads the pre-install cached list and the
      // new card doesn't appear until the next manual reload.
      pluginsCache.invalidate()
      childBridgesService.invalidate()

      // Trigger refresh of the plugin list in the background
      onRefreshPluginList()

      // Fetch the updated plugin data and close with it
      try {
        const installedPlugins = await pluginsCache.get()
        const installedPlugin = installedPlugins.find(x => x.name === pluginName)
        closeModal({ action: 'just-installed', plugin: installedPlugin })
      } catch (error) {
        console.error('Failed to fetch updated plugin data:', error)
        closeModal({ action: 'just-installed', pluginName })
      }
    }, (error) => {
      speakAction('plugins.a11y.install_failed', 3000)
      setActionFailed(true)
      console.error(error)
      void navigate('/plugins')
      toastApiError(error)
    })
  }

  function uninstall(): void {
    io().request('uninstall', {
      name: pluginName,
      termCols: term().cols,
      termRows: term().rows,
    }).then(() => {
      speakAction('plugins.a11y.uninstalled_restart', 3000)
      pluginsCache.invalidate()
      childBridgesService.invalidate()
      // Trigger refresh of the plugin list in the background
      onRefreshPluginList()

      closeModal()
      void navigate('/plugins')
      open(RestartHomebridge, {}, { size: 'lg', backdrop: 'static', keyboard: false })
    }, (error) => {
      speakAction('plugins.a11y.uninstall_failed', 3000)
      setActionFailed(true)
      console.error(error)
      toastApiError(error)
    })
  }

  async function upgradeHomebridge(): Promise<void> {
    let res = 'update'

    // Only want to show this modal updating from existing version <2 to 2
    // This is just some temporary not-so-great logic to determine if the user is updating from <2 to 2
    if (
      Number(installedVersion.split('.')[0]) < 2
      && ['2', 'alpha', 'beta'].includes(targetVersion.split('.')[0])
    ) {
      const ref = open(HbV2Modal, { isUpdating: true, skipIfCompatible: false }, { size: 'lg', backdrop: 'static' })
      try {
        res = await ref.result
      } catch {
        // Dismissed: treated like any answer other than 'update'
        res = 'dismissed'
      }
    }

    if (res === 'update') {
      // Continue selected, so update homebridge
      speakAction('plugins.a11y.updating_homebridge', 4000)
      io().request('homebridge-update', {
        version: targetVersion,
        termCols: term().cols,
        termRows: term().rows,
      }).then(async () => {
        closeModal()
        try {
          await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
        } catch (error) {
          console.error(error)
        }
        void navigate('/restart')
      }, (error) => {
        setActionFailed(true)
        console.error(error)
        toastApiError(error, 'toast.title_error')
        closeModal()
      })
    } else {
      // Modal dismissed, also close the update modal
      closeModal()
    }
  }

  async function getVersionNotes(): Promise<void> {
    setReleaseNotesShow(true)

    try {
      const reqChangelog = await api.get<any>(`/plugins/release/${encodeURIComponent(pluginName)}`, {
        params: { version: targetVersion },
      })
      setFullChangelog(reqChangelog.changelog)

      // Only update targetVersionPretty from changelog if we're targeting 'latest'
      if (reqChangelog.latestVersion && targetVersion === 'latest') {
        setTargetVersionPretty(reqChangelog.latestVersion)
      }

      if (reqChangelog.notes) {
        setVersionNotes(reqChangelog.notes)
        setVersionNotesShow(true)
      } else {
        const isPrerelease = ['beta', 'alpha', 'test', 'next'].includes(targetVersion) || targetVersion.includes('-')
        setVersionNotesShow(!isPrerelease)
      }
    } catch (error) {
      console.error('Error loading release notes:', error)
    }

    setFullChangelogLoaded(true)
    setVersionNotesLoaded(true)
  }

  async function getChildBridges(): Promise<ChildBridge[]> {
    const data = await childBridgesService.getAll()
    const pluginBridges = data.filter(bridge => pluginName === bridge.plugin)
    setChildBridges(pluginBridges)
    return pluginBridges
  }

  useEffect(() => {
    unmountedRef.current = false
    const terminal = xtermFactory.createTerminal(settingsActions.getTerminalOptions({ disableStdin: true }))
    const fitAddon = xtermFactory.createFitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(xtermFactory.createWebLinksAddon())
    termRef.current = terminal

    const handle = ws.connectToNamespace('plugins')
    ioRef.current = handle
    terminal.open(termTargetRef.current!)
    fitAddon.fit()

    const stdoutHandler = (data: string | Uint8Array) => {
      terminal.write(data)
      // xterm recreates the textarea/live-region as it renders, so re-patch on every write
      applyXtermA11yPatches()
      const dataCleaned = data
        .toString()
        .replace(RE_ANSI, '')
        .trimEnd()
      if (dataCleaned) {
        errorLogRef.current += `${dataCleaned}\r\n`
      }
    }
    handle.socket.on('stdout', stdoutHandler)

    // Initial patches — xterm's internal accessibility DOM is created lazily
    applyXtermA11yPatches()
    const patchTimer0 = setTimeout(applyXtermA11yPatches, 0)
    const patchTimer50 = setTimeout(applyXtermA11yPatches, 50)
    const patchTimer250 = setTimeout(applyXtermA11yPatches, 250)

    // Start the action one task later, so the throwaway first mount of
    // StrictMode (mount, unmount, mount) never runs npm twice
    const start = setTimeout(() => {
      switch (action) {
        case 'Install':
          speakAction('plugins.a11y.installing', 4000)
          install()
          break
        case 'Uninstall':
          speakAction('plugins.a11y.uninstalling', 4000)
          uninstall()
          break
        case 'Update':
          void getVersionNotes()
          break
      }
    }, 0)

    return () => {
      unmountedRef.current = true
      clearTimeout(start)
      clearTimeout(patchTimer0)
      clearTimeout(patchTimer50)
      clearTimeout(patchTimer250)
      if (restoreTerminalTimerRef.current) {
        clearTimeout(restoreTerminalTimerRef.current)
        restoreTerminalTimerRef.current = null
      }
      // The plugins namespace is cached and shared, and `end()` keeps its
      // listeners, so detach ours before ending the session
      handle.socket.off('stdout', stdoutHandler)
      handle.end()
      terminal.dispose()
    }
    // Runs once per mount, like ngOnInit/ngOnDestroy
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  function update(): void {
    // Hide the release notes
    setReleaseNotesShow(false)
    setVersionNotes('')
    setFullChangelog('')

    if (!onlineUpdateOk) {
      return
    }

    // If this is updating homebridge, use an alternative workflow
    if (pluginName === 'homebridge') {
      void upgradeHomebridge()
      return
    }

    speakAction('plugins.a11y.updating', 4000)

    io().request('update', {
      name: pluginName,
      version: targetVersion,
      termCols: term().cols,
      termRows: term().rows,
    }).then(async () => {
      // Updating the UI needs a restart straight away
      if (pluginName === '@mp-consulting/homebridge-config-glass-ui') {
        try {
          // Set full service restart flag to ensure hb-service restarts properly
          await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
        } catch (error) {
          console.error('Failed to set restart flag:', error)
        }
        window.location.href = 'restart'
        return
      }

      let bridges: ChildBridge[] = []
      try {
        bridges = await getChildBridges()
      } catch (error) {
        console.error(error)
      }

      // Invalidate caches BEFORE notifying the plugins page so the new
      // version metadata flows through on the same refresh cycle.
      pluginsCache.invalidate()
      childBridgesService.invalidate()

      // Trigger refresh of the plugin list in the background
      onRefreshPluginList()

      // If plugin is not configured and has no child bridges, no restart needed
      if (!initialIsConfigured && bridges.length === 0) {
        toast.success(i18n.t('plugins.manage.toast_success', { verb: liveRef.current.pastTenseVerb, name: pluginName }), toastSuccess())
        closeModal()
        void navigate('/plugins')
      } else {
        // Plugin is configured or has child bridges, show restart UI
        speakAction('plugins.a11y.updated_restart', 3000)
        setActionComplete(true)
        setJustUpdatedPlugin(true)
        void navigate('/plugins')
      }
    }, (error) => {
      speakAction('plugins.a11y.update_failed', 3000)
      setActionFailed(true)
      console.error(error)
      toastApiError(error)
    })
  }

  function onRestartHomebridgeClick(): void {
    void navigate('/restart')
    activeModal.close()
  }

  async function onRestartChildBridgeClick(): Promise<void> {
    try {
      for (const bridge of childBridges) {
        await api.put(`/server/restart/${bridge.username}`, {})
      }
      open(PluginLogs, {
        plugin: {
          name: pluginName,
          displayName: pluginDisplayName,
        },
        childBridges,
      }, { size: 'xl', backdrop: 'static' })
    } catch (error) {
      console.error(error)
      toast.error(t('plugins.manage.child_bridge_restart_failed'), t('toast.title_error'))
    } finally {
      activeModal.close()
    }
  }

  function downloadLogFile(): void {
    const blob = new Blob([errorLogRef.current], { type: 'text/plain;charset=utf-8' })
    fileSaver.saveAs(blob, `${pluginName}-error.log`)
  }

  async function downloadBackupFile(): Promise<void> {
    setDownloadingBackup(true)
    try {
      await backupService.downloadBackup()
    } catch (error) {
      console.error(error)
      toastApiError(error, 'toast.title_error')
    } finally {
      if (!unmountedRef.current) {
        setDownloadingBackup(false)
      }
    }
  }

  function dismissModal(): void {
    activeModal.dismiss('Dismiss')
  }

  async function goBack(): Promise<void> {
    // Close current modal and reopen the version picker
    activeModal.dismiss('Back')

    const ref = open(ManageVersion, {
      plugin: backToVersionModal,
      onRefreshPluginList,
    }, { size: 'lg', backdrop: 'static' })

    try {
      const { action: versionAction, version } = await ref.result

      // Reopen the manage plugin modal with the selected version
      open(ManagePlugin, {
        action: versionAction === 'alternate' ? 'Update' : 'Install',
        pluginName,
        pluginDisplayName,
        targetVersion: version,
        latestVersion,
        installedVersion,
        isDisabled,
        isConfigured: initialIsConfigured,
        onRefreshPluginList,
        verifiedPlugin,
        verifiedPlusPlugin,
        funding,
        backToVersionModal,
      }, { size: 'lg', backdrop: 'static' })
    } catch {
      // Modal was dismissed, do nothing
    }
  }

  const showBack = backToVersionModal && !actionComplete
  const closeOrBackLabel = t(showBack ? 'form.button_back' : 'form.button_close')
  const isPrereleaseTarget = targetVersion.includes('beta') || targetVersion.includes('alpha') || targetVersion.includes('next')

  const spinner = (
    <div className="w-100 text-center primary-text mt-3 mb-4">
      <i className="fas fa-circle-notch fa-spin icon-xl" aria-hidden="true"></i>
    </div>
  )

  const notesPane = (
    <div className="alert release-notes p-3 pb-1 my-0">
      {action === 'Update' && !versionNotesLoaded
        ? spinner
        : versionNotes
          ? <Markdown className="plugin-md" data={versionNotes} />
          : versionNotesShow
            ? <div className="w-100 text-center grey-text mt-3 mb-4">{t('plugins.manage.notes_none')}</div>
            : isPrereleaseTarget
              ? (
                  <div className="w-100 text-center grey-text mt-3 mb-4">
                    {t('plugins.manage.notes_beta_1', { pluginName: pluginDisplayName })}
                    <br />
                    {t('plugins.manage.notes_beta_2')}
                    <br />
                    {t('plugins.manage.notes_beta_3')}
                    <br />
                  </div>
                )
              : <div className="w-100 text-center grey-text mt-3 mb-4">{t('plugins.manage.notes_latest')}</div>}
    </div>
  )

  const changelogPane = (
    <div className="alert release-notes p-3 pb-1 my-0">
      {action === 'Update' && !fullChangelogLoaded
        ? spinner
        : fullChangelog
          ? <Markdown className="plugin-md" data={fullChangelog} />
          : <SafeHtml className="w-100 text-center grey-text mt-3 mb-4" html={t('plugins.manage.changelog_none')} />}
    </div>
  )

  const tabs = [
    { id: 1, label: t('plugins.manage.notes'), pane: notesPane },
    { id: 2, label: t('plugins.manage.changelog'), pane: changelogPane },
  ]

  return (
    <div className={`modal-content hb-manage-plugin${isLightTerminalTheme ? ' terminal-light-theme' : ''}`}>
      <ModalHeader title={pluginDisplayName} onClose={dismissModal} />
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {actionLiveMessage}
      </span>
      <div
        ref={termTargetRef}
        id="plugin-log-output"
        className={`modal-body ${isLightTerminalTheme ? 'terminal-light-bg' : 'terminal-dark-bg'}`}
        hidden={!onlineUpdateOk || actionComplete || releaseNotesShow}
        aria-hidden={terminalAriaHidden ? 'true' : undefined}
      >
      </div>
      {actionComplete && (
        <div className="modal-body plugin-modal-body" role="status" aria-live="polite" aria-atomic="true">
          {justUpdatedPlugin && (
            <>
              <div className="mb-3 text-center">
                <i className="far fa-check-circle primary-text icon-xl" aria-hidden="true"></i>
              </div>
              <h5 className="text-center mb-3">
                {pastTenseVerb}
                :
                {' '}
                {pluginDisplayName}
                {' '}
                (
                {targetVersionPretty}
                )
              </h5>
              {!isDisabled && (
                <>
                  <SafeHtml
                    as="p"
                    className="mb-3 text-center grey-text"
                    html={t(supportMessageKey, { ...ICONS, link: donationLink })}
                  />
                  {childBridges.length === 0
                    ? <p className="text-center mb-0">{t('plugins.settings.restart_required')}</p>
                    : <p className="text-center mb-0">{t('restart.child_bridges')}</p>}
                </>
              )}
            </>
          )}
        </div>
      )}
      {!onlineUpdateOk && (
        <div className="modal-body">
          <div className="mb-3 text-center">
            <i
              className={cx(
                'fas primary-text icon-xl',
                action === 'Install' && 'fa-arrow-alt-circle-down',
                action === 'Update' && installedVersion && 'fa-code-compare',
                action === 'Update' && !installedVersion && 'fa-arrow-alt-circle-up',
                action === 'Uninstall' && 'fa-trash',
              )}
              aria-hidden="true"
            >
            </i>
          </div>
          <ul className="mb-3">
            <li>{t('plugins.manage.online_updates')}</li>
            <li>{t('plugins.manage.manual_update_command')}</li>
          </ul>
          <pre className="p-2 mb-0">
            {`hb-service stop
npm install -g ${pluginName}@${targetVersion}
hb-service start`}
          </pre>
        </div>
      )}
      {releaseNotesShow && !actionComplete && onlineUpdateOk && (
        <div className="modal-body plugin-modal-body">
          <div className="mb-3 text-center">
            <i
              className={cx(
                'far primary-text icon-xl',
                action === 'Install' && !installedVersion && 'fa-arrow-alt-circle-down',
                action === 'Install' && installedVersion && 'fa-code-compare',
                action === 'Update' && 'fa-arrow-alt-circle-up',
                action === 'Uninstall' && 'fa-trash',
              )}
              aria-hidden="true"
            >
            </i>
          </div>
          {latestVersion && (
            <h5 className="mb-4 text-center">
              {installedVersion && (
                <span>
                  v
                  {installedVersion}
                  {' '}
                  &rarr;
                  {' '}
                </span>
              )}
              {targetVersionPretty}
            </h5>
          )}
          <ul className="nav-tabs px-0 nav" role="tablist">
            {tabs.map(tab => (
              <li key={tab.id} className="w-50 m-0 nav-item" role="presentation">
                <button
                  type="button"
                  className={`w-100 release-tab nav-link${releaseNotesTab === tab.id ? ' active' : ''}`}
                  role="tab"
                  id={`manage-plugin-nav-${tab.id}`}
                  aria-controls={`manage-plugin-nav-${tab.id}-panel`}
                  aria-selected={releaseNotesTab === tab.id}
                  onClick={() => setReleaseNotesTab(tab.id)}
                >
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 tab-content">
            {tabs.filter(tab => tab.id === releaseNotesTab).map(tab => (
              <div
                key={tab.id}
                className="tab-pane active"
                role="tabpanel"
                id={`manage-plugin-nav-${tab.id}-panel`}
                aria-labelledby={`manage-plugin-nav-${tab.id}`}
              >
                {tab.pane}
              </div>
            ))}
          </div>

          {SELF_PACKAGES.includes(pluginName) && (
            <div className="mt-4 mb-0">
              <p className="w-100 text-center mb-1 small">
                <span className="grey-text">{t('plugins.manage.backup')}</span>
                {downloadingBackup
                  ? <span className="mx-1"><i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i></span>
                  : (
                      <button
                        type="button"
                        className="btn btn-link p-0 align-baseline text-decoration-none"
                        aria-label={t('form.button_download')}
                        onClick={() => void downloadBackupFile()}
                      >
                        <i className="fas fa-download mx-1" aria-hidden="true"></i>
                      </button>
                    )}
              </p>
              <p className="w-100 text-center mb-0 small grey-text">{t('plugins.manage.hb_restart')}</p>
            </div>
          )}
        </div>
      )}
      {(!onlineUpdateOk || actionComplete || releaseNotesShow || actionFailed) && (
        <ModalFooter>
          <div className="text-start">
            {((!justUpdatedPlugin && onlineUpdateOk) || (justUpdatedPlugin && (!isDisabled || actionFailed))) && (
              <button
                type="button"
                className="btn btn-elegant"
                data-bs-dismiss="modal"
                aria-label={closeOrBackLabel}
                onClick={() => (showBack ? void goBack() : dismissModal())}
              >
                {closeOrBackLabel}
              </button>
            )}
          </div>
          <div className="text-center">
            {((justUpdatedPlugin && isDisabled && !actionFailed) || !onlineUpdateOk) && (
              <button
                type="button"
                className="btn btn-elegant"
                data-bs-dismiss="modal"
                aria-label={t('form.button_close')}
                onClick={dismissModal}
              >
                {t('form.button_close')}
              </button>
            )}
          </div>
          <div className="text-end">
            {onlineUpdateOk && releaseNotesShow && (
              <button type="button" className="btn btn-primary" onClick={update}>
                {t('form.button_continue')}
              </button>
            )}
            {justUpdatedPlugin && !isDisabled && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => (childBridges.length > 0 ? void onRestartChildBridgeClick() : onRestartHomebridgeClick())}
              >
                {t('menu.tooltip_restart')}
              </button>
            )}
            {actionFailed && (
              <button type="button" className="btn btn-primary" onClick={downloadLogFile}>
                {t('form.button_download')}
              </button>
            )}
          </div>
        </ModalFooter>
      )}
    </div>
  )
}
