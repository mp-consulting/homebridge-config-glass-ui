import type { ManagePluginProps } from '@/core/plugins/manage-plugin/ManagePlugin'
import type { FakeApi, FakeCache, FakeIoNamespace, FakeOpenModal, FakeTerminals, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { backupService } from '@/core/backup/backup.service'
import { pluginsCache as realPluginsCache } from '@/core/caching/plugins-cache'
import { HbV2Modal } from '@/core/components/hb-v2-modal/HbV2Modal'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { ManagePlugin } from '@/core/plugins/manage-plugin/ManagePlugin'
import { ManageVersion } from '@/core/plugins/manage-version/ManageVersion'
import { PluginLogs } from '@/core/plugins/plugin-logs/PluginLogs'
import { useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import * as modalModule from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { childBridges } from '@/core/utilities/child-bridges'
import { fileSaver } from '@/core/utilities/file-saver'
import { xtermFactory } from '@/core/utilities/terminal/terminal.factory'
import { ws as realWs } from '@/core/ws'
import { WsDisconnectedError } from '@/core/ws/ws'
import { activeModalStub, apiError, fakeApi, makeChildBridge, makePlugin, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/caching/plugins-cache', async () => ({ pluginsCache: (await import('@/testing')).cacheStub<any[]>([]) }))
vi.mock('@/core/utilities/child-bridges', () => ({ childBridges: { getAll: vi.fn(async () => []), invalidate: vi.fn() } }))
vi.mock('@/core/backup/backup.service', () => ({ backupService: { downloadBackup: vi.fn(async () => undefined) } }))
vi.mock('@/core/utilities/terminal/terminal.factory', async () => {
  const terminals = (await import('@/testing')).fakeTerminals()
  return { xtermFactory: { ...terminals.factory, terminals } }
})
vi.mock('@/core/plugins/plugin-logs/PluginLogs', () => ({ PluginLogs: () => null }))
vi.mock('@/core/plugins/manage-version/ManageVersion', () => ({ ManageVersion: () => null }))
vi.mock('@/core/components/hb-v2-modal/HbV2Modal', () => ({ HbV2Modal: () => null }))
vi.mock('@/core/components/restart-homebridge/RestartHomebridge', () => ({ RestartHomebridge: () => null }))

const ws = realWs as unknown as FakeWs
const modal = modalModule as unknown as FakeOpenModal
const pluginsCache = realPluginsCache as unknown as FakeCache<any[]>
const xterm = (xtermFactory as unknown as { terminals: FakeTerminals }).terminals
const cb = childBridges as unknown as { getAll: ReturnType<typeof vi.fn>, invalidate: ReturnType<typeof vi.fn> }
const backup = backupService as unknown as { downloadBackup: ReturnType<typeof vi.fn> }

/**
 * The one modal in the app that runs npm.
 *
 * Everything else - the plugin cards, the version picker, the uninstall
 * confirmation - only decides what should happen and then opens this. So this is
 * the last point at which a wrong plugin name or version can be caught, and the
 * only place that knows whether the user needs to restart afterwards.
 *
 * Two things here are ordering rather than logic, and both have bitten before:
 * the caches must be invalidated before the plugins page is told to refresh, or
 * it reads the pre-install list; and updating the UI itself has to set a restart
 * flag before navigating, because the page is about to be replaced.
 */
describe('managePlugin', () => {
  let api: FakeApi
  let io: FakeIoNamespace
  let activeModal: ReturnType<typeof activeModalStub>
  let onRefreshPluginList: ReturnType<typeof vi.fn>
  let saveAs: ReturnType<typeof vi.spyOn>
  let view: ReturnType<typeof renderWithProviders>

  /** Let the deferred start, the socket acks and the awaits after them run. */
  async function settle() {
    await act(async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(1)
      } else {
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      for (let tick = 0; tick < 15; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  /**
   * Render the modal.
   * @param data - the manage-plugin modal data
   * @param arrange - runs after the fakes are built, before the modal mounts
   */
  async function open(data: Partial<ManagePluginProps>, arrange?: () => void) {
    arrange?.()
    view = renderWithProviders(
      <ManagePlugin activeModal={activeModal as any} pluginName="homebridge-test" onRefreshPluginList={onRefreshPluginList} {...data as any} />,
      { route: '/*' },
    )
    await settle()
    return view
  }

  const path = () => view.router.state.location.pathname
  const continueButton = () => screen.getByRole('button', { name: 'form.button_continue' })

  async function clickContinue() {
    fireEvent.click(continueButton())
    await settle()
  }

  beforeEach(() => {
    api = fakeApi()
    // Opening an update always fetches the release notes
    api.respond('get', /\/plugins\/release\//, {})
    useSettingsStore.setState(makeSettingsState())
    ws.namespaces.clear()
    io = ws.namespace('plugins')
    modal.opened.length = 0
    activeModal = activeModalStub()
    onRefreshPluginList = vi.fn()
    xterm.reset()
    pluginsCache.setValue([makePlugin()])
    pluginsCache.get.mockClear()
    pluginsCache.invalidate.mockClear()
    cb.getAll.mockReset()
    cb.getAll.mockImplementation(async () => [])
    cb.invalidate.mockClear()
    backup.downloadBackup.mockReset()
    backup.downloadBackup.mockImplementation(async () => undefined)
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    saveAs = vi.spyOn(fileSaver, 'saveAs').mockImplementation(() => {})
    saveAs.mockClear()
    // The support message is shown on a coin flip; 0.9 never qualifies
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(Math.random).mockRestore()
  })

  describe('naming the version it is about to install', () => {
    const heading = () => document.querySelector('.plugin-modal-body h5')?.textContent

    it('resolves the latest tag to the version behind it', async () => {
      await open({ action: 'Update', targetVersion: 'latest', latestVersion: '2.1.0' })

      expect(heading()).toBe('v2.1.0')
    })

    it('prefixes an explicit version number', async () => {
      await open({ action: 'Update', targetVersion: '1.9.3', latestVersion: '2.0.0', installedVersion: '1.0.0' })

      expect(heading()).toBe('v1.0.0 → v1.9.3')
    })

    it('leaves a named tag alone', async () => {
      await open({ action: 'Update', targetVersion: 'beta', latestVersion: '2.0.0' })

      // 'vbeta' would be nonsense, so only versions get the prefix
      expect(heading()).toBe('beta')
    })
  })

  describe('installing a plugin', () => {
    it('asks the server to install the named version at the terminal size', async () => {
      await open({ action: 'Install', targetVersion: '2.0.0' })

      expect(io.requests).toEqual([{
        resource: 'install',
        payload: { name: 'homebridge-test', version: '2.0.0', termCols: 80, termRows: 24 },
      }])
    })

    it('clears the caches before telling the plugins page to reload', async () => {
      await open({ action: 'Install', targetVersion: '2.0.0' }, () => {
        io.socket.respondTo('install', {})
      })

      expect(cb.invalidate).toHaveBeenCalled()
      expect(onRefreshPluginList).toHaveBeenCalled()
      expect(pluginsCache.invalidate.mock.invocationCallOrder[0])
        .toBeLessThan(onRefreshPluginList.mock.invocationCallOrder[0])
    })

    it('closes with the freshly installed plugin', async () => {
      await open({ action: 'Install', targetVersion: '2.0.0' }, () => {
        io.socket.respondTo('install', {})
      })

      expect(activeModal.close).toHaveBeenCalledWith({
        action: 'just-installed',
        plugin: expect.objectContaining({ name: 'homebridge-test' }),
      })
    })

    it('still closes when the new plugin cannot be read back', async () => {
      await open({ action: 'Install', targetVersion: '2.0.0' }, () => {
        io.socket.respondTo('install', {})
        pluginsCache.get.mockRejectedValueOnce(new Error('offline'))
      })

      expect(activeModal.close).toHaveBeenCalledWith({ action: 'just-installed', pluginName: 'homebridge-test' })
    })

    it('calls it a reinstall when the version is not changing', async () => {
      const t = vi.spyOn(i18n, 't')
      await open({ action: 'Install', targetVersion: '1.0.0', installedVersion: '1.0.0' }, () => {
        io.socket.respondTo('install', {})
      })

      expect(t).toHaveBeenCalledWith('plugins.manage.toast_success', { verb: 'plugins.manage.reinstalled', name: 'homebridge-test' })
      t.mockRestore()
    })

    it('stays open on failure so the log can be read', async () => {
      await open({ action: 'Install', targetVersion: '2.0.0' }, () => {
        io.socket.respondTo('install', { error: 'ETARGET no matching version' })
      })

      expect(screen.getByRole('button', { name: 'form.button_download' })).toBeInTheDocument()
      expect(activeModal.close).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(path()).toBe('/plugins')
    })

    it('refuses to install homebridge over the network on windows', async () => {
      await open({ action: 'Install', pluginName: 'homebridge', targetVersion: '2.0.0' }, () => {
        useSettingsStore.setState(makeSettingsState({ env: { platform: 'win32' } }))
      })

      // On Windows these two are installed by the installer, not npm
      expect(screen.getByText('plugins.manage.online_updates')).toBeInTheDocument()
      expect(document.querySelector('pre')?.textContent).toContain('npm install -g homebridge@2.0.0')
      expect(io.requests).toHaveLength(0)
    })

    it('allows an ordinary plugin on windows', async () => {
      await open({ action: 'Install', targetVersion: '2.0.0' }, () => {
        useSettingsStore.setState(makeSettingsState({ env: { platform: 'win32' } }))
      })

      expect(screen.queryByText('plugins.manage.online_updates')).toBeNull()
      expect(io.requests).toHaveLength(1)
    })

    it('runs npm once, even when StrictMode mounts it twice', async () => {
      const { StrictMode } = await import('react')
      view = renderWithProviders(
        <StrictMode>
          <ManagePlugin activeModal={activeModal as any} pluginName="homebridge-test" action="Install" targetVersion="2.0.0" />
        </StrictMode>,
        { route: '/*' },
      )
      await settle()

      expect(io.requests).toHaveLength(1)
    })
  })

  describe('uninstalling a plugin', () => {
    it('asks the server to uninstall, without a version', async () => {
      await open({ action: 'Uninstall' })

      expect(io.requests[0]).toEqual({
        resource: 'uninstall',
        payload: { name: 'homebridge-test', termCols: 80, termRows: 24 },
      })
    })

    it('sends the user to restart afterwards', async () => {
      await open({ action: 'Uninstall' }, () => {
        io.socket.respondTo('uninstall', {})
      })

      expect(activeModal.close).toHaveBeenCalled()
      expect(path()).toBe('/plugins')
      expect(modal.lastOpened()?.component).toBe(RestartHomebridge)
      expect(modal.lastOpened()?.options?.keyboard).toBe(false)
    })

    it('stays open on failure', async () => {
      await open({ action: 'Uninstall' }, () => {
        io.socket.respondTo('uninstall', { error: 'EACCES permission denied' })
      })

      expect(screen.getByRole('button', { name: 'form.button_download' })).toBeInTheDocument()
      expect(activeModal.close).not.toHaveBeenCalled()
    })
  })

  describe('updating a plugin', () => {
    it('waits for the user rather than updating on open', async () => {
      await open({ action: 'Update', targetVersion: 'latest' })

      expect(io.requests).toHaveLength(0)
      expect(continueButton()).toBeInTheDocument()
    })

    it('closes quietly when nothing needs restarting', async () => {
      await open({ action: 'Update', targetVersion: 'latest', isConfigured: false }, () => {
        io.socket.respondTo('update', {})
      })

      await clickContinue()

      expect(activeModal.close).toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: 'menu.tooltip_restart' })).toBeNull()
      expect(toast.success).toHaveBeenCalledTimes(1)
    })

    it('offers a restart when the plugin is configured', async () => {
      await open({ action: 'Update', targetVersion: 'latest', isConfigured: true }, () => {
        io.socket.respondTo('update', {})
      })

      await clickContinue()

      expect(screen.getByRole('button', { name: 'menu.tooltip_restart' })).toBeInTheDocument()
      expect(screen.getByText('plugins.settings.restart_required')).toBeInTheDocument()
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('offers a restart when the plugin has child bridges, even unconfigured', async () => {
      await open({ action: 'Update', targetVersion: 'latest', isConfigured: false }, () => {
        io.socket.respondTo('update', {})
        cb.getAll.mockImplementation(async () => [makeChildBridge({ plugin: 'homebridge-test' })])
      })

      await clickContinue()

      expect(screen.getByText('restart.child_bridges')).toBeInTheDocument()
    })

    it('ignores child bridges belonging to other plugins', async () => {
      await open({ action: 'Update', targetVersion: 'latest', isConfigured: false }, () => {
        io.socket.respondTo('update', {})
        cb.getAll.mockImplementation(async () => [makeChildBridge({ plugin: 'homebridge-other' })])
      })

      await clickContinue()

      expect(activeModal.close).toHaveBeenCalled()
    })

    it('hides the release notes once the update starts', async () => {
      await open({ action: 'Update', targetVersion: 'latest' })

      fireEvent.click(continueButton())

      expect(document.querySelector('.release-notes')).toBeNull()
      expect(document.getElementById('plugin-log-output')).not.toHaveAttribute('hidden')
    })

    it('sets the restart flag before replacing the page when updating the ui', async () => {
      await open({ action: 'Update', pluginName: '@mp-consulting/homebridge-config-glass-ui', targetVersion: 'latest' }, () => {
        io.socket.respondTo('update', {})
      })

      await clickContinue()

      expect(api.callsTo('put', '/platform-tools/hb-service/set-full-service-restart-flag')).toHaveLength(1)
      expect(window.location.href).toBe('restart')
    })

    it('still navigates when the restart flag cannot be set', async () => {
      await open({ action: 'Update', pluginName: '@mp-consulting/homebridge-config-glass-ui', targetVersion: 'latest' }, () => {
        io.socket.respondTo('update', {})
        api.fail('put', '/platform-tools/hb-service/set-full-service-restart-flag', new Error('offline'))
      })

      await clickContinue()

      expect(window.location.href).toBe('restart')
    })

    it('waits on the restart page when the ui restarts before acknowledging its update', async () => {
      await open({ action: 'Update', pluginName: '@mp-consulting/homebridge-config-glass-ui', targetVersion: 'latest' }, () => {
        io.request.mockImplementationOnce(() => Promise.reject(new WsDisconnectedError('update', 'transport close')))
      })

      await clickContinue()

      // The server is already going down, so no restart request is sent
      expect(window.location.href).toBe('restart?restarting=true&uiRestarting=true')
      expect(api.callsTo('put', '/platform-tools/hb-service/set-full-service-restart-flag')).toHaveLength(0)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('reports a dropped connection while updating any other plugin as a failure', async () => {
      await open({ action: 'Update', targetVersion: 'latest' }, () => {
        io.request.mockImplementationOnce(() => Promise.reject(new WsDisconnectedError('update', 'transport close')))
      })

      await clickContinue()

      expect(screen.getByRole('button', { name: 'form.button_download' })).toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledTimes(1)
    })

    it('does nothing at all when online updates are blocked', async () => {
      await open({ action: 'Update', pluginName: '@mp-consulting/homebridge-config-glass-ui', targetVersion: 'latest' }, () => {
        useSettingsStore.setState(makeSettingsState({ env: { platform: 'win32' } }))
      })

      expect(screen.queryByRole('button', { name: 'form.button_continue' })).toBeNull()
      expect(io.requests).toHaveLength(0)
    })

    it('stays open on failure', async () => {
      await open({ action: 'Update', targetVersion: 'latest' }, () => {
        io.socket.respondTo('update', { error: 'network timeout' })
      })

      await clickContinue()

      expect(screen.getByRole('button', { name: 'form.button_download' })).toBeInTheDocument()
      expect(activeModal.close).not.toHaveBeenCalled()
    })
  })

  describe('the release notes', () => {
    it('asks for the changelog of the version being installed', async () => {
      await open({ action: 'Update', targetVersion: '2.0.0' }, () => {
        api.respond('get', '/plugins/release/homebridge-test', { changelog: '## 2.0.0', notes: 'Breaking changes' })
      })

      expect(api.lastCall('get', '/plugins/release/homebridge-test')?.options).toEqual({ params: { version: '2.0.0' } })
    })

    it('shows the highlighted notes when the release has them', async () => {
      await open({ action: 'Update', targetVersion: '2.0.0' }, () => {
        api.respond('get', '/plugins/release/homebridge-test', { changelog: '## 2.0.0', notes: 'Breaking changes' })
      })

      expect(document.querySelector('.tab-pane .plugin-md')?.textContent).toContain('Breaking changes')
    })

    it('switches to the full changelog tab', async () => {
      await open({ action: 'Update', targetVersion: '2.0.0' }, () => {
        api.respond('get', '/plugins/release/homebridge-test', { changelog: '## Big list', notes: 'Breaking changes' })
      })

      fireEvent.click(screen.getByRole('tab', { name: 'plugins.manage.changelog' }))

      expect(screen.getByRole('tab', { name: 'plugins.manage.changelog' })).toHaveAttribute('aria-selected', 'true')
      expect(document.querySelector('.tab-pane .plugin-md')?.textContent).toContain('Big list')
    })

    it('takes the resolved version from the changelog for a latest update', async () => {
      await open({ action: 'Update', targetVersion: 'latest', latestVersion: '2.0.0' }, () => {
        api.respond('get', '/plugins/release/homebridge-test', { changelog: '## 2.1.0', latestVersion: 'v2.1.0' })
      })

      expect(document.querySelector('.plugin-modal-body h5')?.textContent).toBe('v2.1.0')
    })

    it('keeps an explicit version even when the changelog names another', async () => {
      await open({ action: 'Update', targetVersion: '1.9.0', latestVersion: '2.0.0' }, () => {
        api.respond('get', '/plugins/release/homebridge-test', { changelog: '## 2.1.0', latestVersion: 'v2.1.0' })
      })

      expect(document.querySelector('.plugin-modal-body h5')?.textContent).toBe('v1.9.0')
    })

    it('says a beta has no written notes rather than an empty panel', async () => {
      await open({ action: 'Update', targetVersion: 'beta' }, () => {
        api.respond('get', '/plugins/release/homebridge-test', { changelog: '## 2.1.0-beta.1' })
      })

      expect(screen.getByText(/plugins.manage.notes_beta_1/)).toBeInTheDocument()
      expect(screen.queryByText('plugins.manage.notes_none')).toBeNull()
    })

    it('treats a version with a prerelease suffix as a prerelease too', async () => {
      await open({ action: 'Update', targetVersion: '2.1.0-beta.1' }, () => {
        api.respond('get', '/plugins/release/homebridge-test', { changelog: '## 2.1.0-beta.1' })
      })

      expect(screen.queryByText('plugins.manage.notes_none')).toBeNull()
    })

    it('says a stable release has no notes', async () => {
      await open({ action: 'Update', targetVersion: '2.1.0' }, () => {
        api.respond('get', '/plugins/release/homebridge-test', { changelog: '## 2.1.0' })
      })

      expect(screen.getByText('plugins.manage.notes_none')).toBeInTheDocument()
    })

    it('finishes loading even when the changelog cannot be fetched', async () => {
      await open({ action: 'Update', targetVersion: 'latest' }, () => {
        api.fail('get', '/plugins/release/homebridge-test', new Error('github rate limit'))
      })

      // A missing changelog must not leave a spinner over the update button
      expect(document.querySelector('.release-notes .fa-spin')).toBeNull()
    })
  })

  describe('updating homebridge itself', () => {
    const v2 = { action: 'Update', pluginName: 'homebridge', targetVersion: '2.0.0', installedVersion: '1.8.5' } as const

    it('warns about the v2 jump before updating', async () => {
      await open(v2)

      await clickContinue()

      expect(modal.lastOpened()?.component).toBe(HbV2Modal)
      expect(modal.lastOpened()?.props).toEqual({ isUpdating: true, skipIfCompatible: false })
    })

    it('skips the warning when already on v2', async () => {
      await open({ ...v2, targetVersion: '2.1.0', installedVersion: '2.0.0' }, () => {
        io.socket.respondTo('homebridge-update', {})
      })

      await clickContinue()

      expect(modal.opened).toHaveLength(0)
      expect(io.requests[0]?.resource).toBe('homebridge-update')
    })

    it('skips the warning for a patch update within v1', async () => {
      await open({ ...v2, targetVersion: '1.8.6' }, () => {
        io.socket.respondTo('homebridge-update', {})
      })

      await clickContinue()

      expect(modal.opened).toHaveLength(0)
    })

    it('goes ahead when the warning is accepted', async () => {
      await open(v2, () => {
        io.socket.respondTo('homebridge-update', {})
      })

      await clickContinue()
      modal.lastOpened()!.ref.close('update')
      await settle()

      expect(io.requests[0]).toEqual({
        resource: 'homebridge-update',
        payload: { version: '2.0.0', termCols: 80, termRows: 24 },
      })
      expect(path()).toBe('/restart')
    })

    it('abandons the update when the warning is declined', async () => {
      await open(v2)

      await clickContinue()
      modal.lastOpened()!.ref.close('cancel')
      await settle()

      expect(io.requests).toHaveLength(0)
      expect(activeModal.close).toHaveBeenCalled()
    })

    it('abandons the update when the warning is dismissed', async () => {
      await open(v2)

      await clickContinue()
      modal.lastOpened()!.ref.dismiss('x')
      await settle()

      expect(io.requests).toHaveLength(0)
      expect(activeModal.close).toHaveBeenCalled()
    })

    it('closes on failure rather than offering a broken restart', async () => {
      await open({ ...v2, targetVersion: '1.8.6' }, () => {
        io.socket.respondTo('homebridge-update', { error: 'npm failed' })
      })

      await clickContinue()

      expect(activeModal.close).toHaveBeenCalled()
      expect(path()).not.toBe('/restart')
      expect(toast.error).toHaveBeenCalled()
    })
  })

  describe('the support message', () => {
    async function supportMessage(data: Partial<ManagePluginProps>) {
      await open({ action: 'Update', targetVersion: 'latest', isConfigured: true, ...data }, () => {
        io.socket.respondTo('update', {})
      })
      await clickContinue()
      return document.querySelector('.plugin-modal-body p.grey-text')!.innerHTML
    }

    it('shows the github message by default', async () => {
      expect(await supportMessage({})).toBe('plugins.manage.support_github')
    })

    it('asks for a donation for a verified plugin that has funding', async () => {
      vi.mocked(Math.random).mockReturnValue(0.1)
      const t = vi.spyOn(i18n, 't')

      expect(await supportMessage({ verifiedPlugin: true, funding: [{ type: 'github', url: 'https://github.com/sponsors/someone' }] }))
        .toBe('plugins.manage.support_donate')
      expect(t).toHaveBeenCalledWith('plugins.manage.support_donate', expect.objectContaining({
        link: expect.stringContaining('href="https://github.com/sponsors/someone"'),
      }))
      t.mockRestore()
    })

    it('names ko-fi when that is where the funding points', async () => {
      vi.mocked(Math.random).mockReturnValue(0.1)

      expect(await supportMessage({ verifiedPlusPlugin: true, funding: 'https://ko-fi.com/someone' as any })).toBe('plugins.manage.support_kofi')
    })

    it('ignores funding on an unverified plugin', async () => {
      vi.mocked(Math.random).mockReturnValue(0.1)

      expect(await supportMessage({ verifiedPlugin: false, funding: [{ url: 'https://ko-fi.com/someone' }] as any })).toBe('plugins.manage.support_github')
    })

    it('is not shown at all for a disabled plugin', async () => {
      await open({ action: 'Update', targetVersion: 'latest', isConfigured: true, isDisabled: true }, () => {
        io.socket.respondTo('update', {})
      })
      await clickContinue()

      expect(document.querySelector('.plugin-modal-body p.grey-text')).toBeNull()
      expect(screen.queryByRole('button', { name: 'menu.tooltip_restart' })).toBeNull()
    })
  })

  describe('the terminal output', () => {
    it('writes the server output straight to the terminal', async () => {
      await open({ action: 'Update', targetVersion: 'latest' })

      io.socket.fire('stdout', 'added 1 package\r\n')

      expect(xterm.term().written).toEqual(['added 1 package\r\n'])
      expect(xterm.term().open).toHaveBeenCalledWith(document.getElementById('plugin-log-output'))
      expect(xterm.term().options).toMatchObject({ disableStdin: true })
    })

    it('saves the log without the colour codes', async () => {
      await open({ action: 'Install' }, () => {
        io.socket.respondTo('install', { error: 'E404' })
      })
      io.socket.fire('stdout', '\u001B[31mnpm ERR! code E404\u001B[39m\r\n')

      fireEvent.click(screen.getByRole('button', { name: 'form.button_download' }))

      const written = await (saveAs.mock.calls[0][0] as Blob).text()
      expect(written).toBe('npm ERR! code E404\r\n')
      expect(saveAs.mock.calls[0][1]).toBe('homebridge-test-error.log')
    })

    it('keeps blank output out of the log', async () => {
      await open({ action: 'Install' }, () => {
        io.socket.respondTo('install', { error: 'E404' })
      })
      io.socket.fire('stdout', '\u001B[2K')

      fireEvent.click(screen.getByRole('button', { name: 'form.button_download' }))

      expect(await (saveAs.mock.calls[0][0] as Blob).text()).toBe('')
    })

    it('detaches its stdout listener, ends the session and disposes the terminal on teardown', async () => {
      await open({ action: 'Update', targetVersion: 'latest' })
      expect(io.socket.handlers('stdout')).toHaveLength(1)

      view.unmount()

      expect(io.socket.handlers('stdout')).toHaveLength(0)
      expect(io.end).toHaveBeenCalled()
      expect(xterm.term().dispose).toHaveBeenCalled()
    })
  })

  describe('what happens after a successful update', () => {
    async function updated(bridges: any[] = []) {
      await open({ action: 'Update', targetVersion: 'latest', isConfigured: true }, () => {
        io.socket.respondTo('update', {})
        cb.getAll.mockImplementation(async () => bridges)
      })
      await clickContinue()
    }

    it('sends the user to the restart page', async () => {
      await updated()

      fireEvent.click(screen.getByRole('button', { name: 'menu.tooltip_restart' }))

      expect(path()).toBe('/restart')
      expect(activeModal.close).toHaveBeenCalled()
    })

    it('restarts each child bridge and shows its log', async () => {
      await updated([
        makeChildBridge({ username: '0E:11:11:11:11:11' }),
        makeChildBridge({ username: '0E:22:22:22:22:22' }),
      ])

      fireEvent.click(screen.getByRole('button', { name: 'menu.tooltip_restart' }))
      await settle()

      expect(api.callsTo('put').map(call => call.url)).toEqual([
        '/server/restart/0E:11:11:11:11:11',
        '/server/restart/0E:22:22:22:22:22',
      ])
      expect(modal.lastOpened()?.component).toBe(PluginLogs)
      expect(modal.lastOpened()?.options).toMatchObject({ size: 'xl' })
      expect(activeModal.close).toHaveBeenCalled()
    })

    it('closes even when a child bridge will not restart', async () => {
      await updated([makeChildBridge()])
      api.fail('put', /\/server\/restart\//, new Error('not running'))

      fireEvent.click(screen.getByRole('button', { name: 'menu.tooltip_restart' }))
      await settle()

      expect(toast.error).toHaveBeenCalledWith('plugins.manage.child_bridge_restart_failed', 'toast.title_error')
      expect(activeModal.close).toHaveBeenCalled()
    })
  })

  describe('the backup offered before updating homebridge or the ui', () => {
    it('downloads a backup and puts the button back afterwards', async () => {
      await open({ action: 'Update', pluginName: 'homebridge', targetVersion: '1.8.6', installedVersion: '1.8.5' })

      fireEvent.click(screen.getByRole('button', { name: 'form.button_download' }))
      await settle()

      expect(backup.downloadBackup).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'form.button_download' })).toBeInTheDocument()
    })

    it('puts the button back when the download fails', async () => {
      backup.downloadBackup.mockRejectedValueOnce(apiError('too big'))
      await open({ action: 'Update', pluginName: 'homebridge', targetVersion: '1.8.6', installedVersion: '1.8.5' })

      fireEvent.click(screen.getByRole('button', { name: 'form.button_download' }))
      await settle()

      expect(screen.getByRole('button', { name: 'form.button_download' })).toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledWith('too big', 'toast.title_error')
    })

    it('is not offered for an ordinary plugin', async () => {
      await open({ action: 'Update', targetVersion: 'latest' })

      expect(screen.queryByText('plugins.manage.backup')).toBeNull()
    })
  })

  describe('going back to the version picker', () => {
    async function openWithBack(data: Partial<ManagePluginProps> = {}) {
      await open({ action: 'Update', targetVersion: '2.0.0', backToVersionModal: makePlugin(), ...data })
      fireEvent.click(screen.getByRole('button', { name: 'form.button_back' }))
      await settle()
    }

    it('reopens the version modal', async () => {
      await openWithBack()

      expect(activeModal.dismiss).toHaveBeenCalledWith('Back')
      expect(modal.lastOpened()?.component).toBe(ManageVersion)
      expect(modal.lastOpened()?.props?.plugin).toMatchObject({ name: 'homebridge-test' })
    })

    it('reopens itself as an update when an alternate version is chosen', async () => {
      await openWithBack({ installedVersion: '1.0.0' })
      modal.lastOpened()!.ref.close({ action: 'alternate', version: '1.5.0' })
      await settle()

      expect(modal.lastOpened()?.component).toBe(ManagePlugin)
      expect(modal.lastOpened()?.props).toMatchObject({ action: 'Update', targetVersion: '1.5.0' })
    })

    it('reopens itself as an install for a first install', async () => {
      await openWithBack()
      modal.lastOpened()!.ref.close({ action: 'install', version: '2.0.0' })
      await settle()

      expect(modal.lastOpened()?.props).toMatchObject({ action: 'Install' })
    })

    it('does nothing when the version picker is dismissed', async () => {
      await openWithBack()
      modal.lastOpened()!.ref.dismiss('Dismiss')
      await settle()

      expect(modal.opened).toHaveLength(1)
    })

    it('offers a plain close once there is no going back', async () => {
      await open({ action: 'Update', targetVersion: '2.0.0' })

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' }).at(-1)!)

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })
  })

  /**
   * What a screen reader hears while a plugin installs.
   *
   * ⚠️ **xterm assumes it is an interactive terminal.** This one only shows install
   * output, so its textarea is a focusable input that does nothing, and its live
   * region announces every line of npm output character by character.
   */
  describe('the install log for a screen reader', () => {
    function withXtermSubtree() {
      const host = document.getElementById('plugin-log-output')!
      const root = document.createElement('div')
      root.className = 'xterm'
      const textarea = document.createElement('textarea')
      const live = document.createElement('div')
      live.setAttribute('aria-live', 'assertive')
      live.setAttribute('aria-atomic', 'true')
      root.append(textarea, live)
      host.append(root)
      return { textarea, live }
    }

    async function settlePatches() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
    }

    it('takes the unusable input out of the tab order and silences xterm', async () => {
      vi.useFakeTimers()
      await open({ action: 'Install' })
      const { textarea, live } = withXtermSubtree()
      textarea.focus()
      await settlePatches()

      // The first patch passes ran before xterm rendered; a write re-patches
      io.socket.fire('stdout', 'x')

      expect(textarea.disabled).toBe(true)
      expect(textarea.getAttribute('aria-hidden')).toBe('true')
      expect(textarea.getAttribute('tabindex')).toBe('-1')
      expect(textarea.getAttribute('readonly')).toBe('true')
      expect(document.activeElement).not.toBe(textarea)
      expect(live.getAttribute('aria-live')).toBe('off')
      expect(live.getAttribute('aria-atomic')).toBe('false')
    })

    it('announces the action itself, muting the log meanwhile', async () => {
      vi.useFakeTimers()
      // npm still running
      await open({ action: 'Install' }, () => io.socket.respondTo('install', () => new Promise(() => {})))

      expect(screen.getByRole('status')).toHaveTextContent('plugins.a11y.installing')
      expect(document.getElementById('plugin-log-output')).toHaveAttribute('aria-hidden', 'true')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })

      expect(document.getElementById('plugin-log-output')).not.toHaveAttribute('aria-hidden')
    })

    it('copes with xterm not having rendered yet', async () => {
      vi.useFakeTimers()

      await open({ action: 'Install' })

      await expect(settlePatches()).resolves.not.toThrow()
    })
  })
})
