import type { FakeIoNamespace, FakeOpenModal, FakeWs } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth'
import { HbV2Modal } from '@/core/components/hb-v2-modal/HbV2Modal'
import { Information } from '@/core/components/information/Information'
import { useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import { ws as realWs } from '@/core/ws'
import { environment } from '@/environments/environment'
import { NodeVersionModal } from '@/modules/status/widgets/update-info-widget/node-version-modal/NodeVersionModal'
import {
  getHomebridgeIconClass,
  getHomebridgeUiIconClass,
  getNodejsIconClass,
  getPluginsIconClass,
} from '@/modules/status/widgets/update-info-widget/update-info.store'
import { UpdateInfoWidget } from '@/modules/status/widgets/update-info-widget/UpdateInfoWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'
import { makeAuthState, makeSettingsState, renderWithProviders } from '@/testing'

const fakes = vi.hoisted(() => ({ managePlugins: {} as Record<string, any> }))

vi.mock('@/core/ws/ws', async importOriginal => ({
  ...(await importOriginal<object>()),
  ws: (await import('@/testing')).fakeWs(),
}))
vi.mock('@/core/ui/modal', async importOriginal => ({
  ...(await importOriginal<object>()),
  ...(await import('@/testing')).fakeOpenModal(),
}))
vi.mock('@/core/plugins/manage-plugins', () => ({
  get managePlugins() {
    return fakes.managePlugins
  },
}))

const modal = modalModule as unknown as FakeOpenModal

const SPINNER = 'fa-circle-notch fa-spin primary-text'
const WARNING = 'fa-exclamation-circle orange-text'
const UPDATE = 'fa-arrow-alt-circle-up orange-text'
const UP_TO_DATE = 'fa-check-circle green-text'
const POLICY_OFF = 'fa-circle green-text'

describe('the update info widget', () => {
  describe('getHomebridgeIconClass', () => {
    const homebridge = (pkg: Record<string, any>, homebridgeUpdatePolicy = 'all') => getHomebridgeIconClass({ homebridgePkg: pkg, homebridgeUpdatePolicy })

    it('spins until the installed version is known', () => {
      expect(homebridge({})).toBe(SPINNER)
    })

    it('warns about multiple instances before anything else', () => {
      expect(homebridge({ installedVersion: '2.0.0', multipleInstances: true, updateAvailable: true })).toBe(WARNING)
    })

    it.each([
      ['all', true, UPDATE],
      ['all', false, UP_TO_DATE],
      ['beta', true, UPDATE],
      ['none', true, POLICY_OFF],
      ['none', false, POLICY_OFF],
      ['major', false, POLICY_OFF],
      ['major', true, UPDATE],
    ])('shows policy %s with update=%s as %s', (policy, updateAvailable, expected) => {
      expect(homebridge({ installedVersion: '2.0.0', updateAvailable }, policy)).toBe(expected)
    })
  })

  describe('getHomebridgeUiIconClass', () => {
    const ui = (pkg: Record<string, any>, homebridgeUiUpdatePolicy = 'all') => getHomebridgeUiIconClass({ homebridgeUiPkg: pkg, homebridgeUiUpdatePolicy })

    it('spins until the installed version is known', () => {
      expect(ui({})).toBe(SPINNER)
    })

    it('has no multiple-instances warning, unlike homebridge itself', () => {
      expect(ui({ installedVersion: '5.0.0', multipleInstances: true, updateAvailable: false })).toBe(UP_TO_DATE)
    })

    it.each([
      ['all', true, UPDATE],
      ['all', false, UP_TO_DATE],
      ['none', true, POLICY_OFF],
      ['major', false, POLICY_OFF],
      ['major', true, UPDATE],
    ])('shows policy %s with update=%s as %s', (policy, updateAvailable, expected) => {
      expect(ui({ installedVersion: '5.0.0', updateAvailable }, policy)).toBe(expected)
    })
  })

  describe('getPluginsIconClass', () => {
    it('spins until the plugin check has finished', () => {
      expect(getPluginsIconClass({ homebridgePluginStatusDone: false, homebridgePluginStatus: [] })).toBe(SPINNER)
    })

    it('offers an update when any plugin has one, and is not policy-gated', () => {
      const done = (plugins: unknown[]) => getPluginsIconClass({ homebridgePluginStatusDone: true, homebridgePluginStatus: plugins })

      expect(done([{ name: 'homebridge-test' }])).toBe(UPDATE)
      expect(done([])).toBe(UP_TO_DATE)
    })
  })

  describe('getNodejsIconClass', () => {
    const node = (info: Record<string, any> | null, nodeUpdatePolicy = 'all', done = true) => getNodejsIconClass({ nodejsInfo: info, nodejsStatusDone: done, nodeUpdatePolicy })

    it('spins until the node check has finished', () => {
      expect(node(null, 'all', false)).toBe(SPINNER)
    })

    it('lets the policy win over an unsupported-version warning', () => {
      // The policy check runs first, so a user who turned node updates off never sees the warning icon
      expect(node({ showNodeUnsupportedWarning: true, updateAvailable: false }, 'none')).toBe(POLICY_OFF)
      expect(node({ showNodeUnsupportedWarning: true, updateAvailable: false }, 'all')).toBe(WARNING)
    })

    it.each([
      ['all', true, UPDATE],
      ['all', false, UP_TO_DATE],
      ['none', true, POLICY_OFF],
      ['major', false, POLICY_OFF],
      ['major', true, UPDATE],
    ])('shows policy %s with update=%s as %s', (policy, updateAvailable, expected) => {
      expect(node({ updateAvailable, showNodeUnsupportedWarning: false }, policy)).toBe(expected)
    })

    it('treats a missing node reading as up to date', () => {
      expect(node(null)).toBe(UP_TO_DATE)
    })
  })

  /**
   * ⚠️ **A null field in the payload means that upstream call failed on the
   * server**, and the tile it belongs to has to stay in its loading state rather
   * than claim everything is up to date.
   */
  describe('the version overview it loads', () => {
    const appWs = realWs as unknown as FakeWs
    let io: FakeIoNamespace
    let saveWidgets: Mock<(...args: any[]) => any>
    let toastError: ReturnType<typeof vi.spyOn>

    function overview(overrides: Record<string, any> = {}) {
      return {
        serverInfo: { nodeVersion: '22.0.0', homebridgeRunningInDocker: false, homebridgeRunningInSynologyPackage: false },
        node: { updateAvailable: false, showNodeUnsupportedWarning: false, architecture: 'arm64', supportsNodeJs24: true },
        homebridge: { name: 'homebridge', installedVersion: '1.8.0', latestVersion: '1.8.0', updateAvailable: false },
        homebridgeUi: { name: '@mp-consulting/homebridge-config-glass-ui', installedVersion: '5.0.0', updateAvailable: true },
        outOfDatePlugins: [],
        docker: { latestVersion: null, latestReleaseBody: '', updateAvailable: false },
        hbV2Ready: true,
        ...overrides,
      }
    }

    async function create(options: { payload?: Record<string, any>, env?: Record<string, any>, admin?: boolean, fails?: boolean, widget?: Record<string, any> } = {}) {
      useAuthStore.setState(makeAuthState({ user: { username: 'admin', admin: options.admin ?? true } }))
      useSettingsStore.setState(makeSettingsState({ env: { packageVersion: '5.0.0', homebridgeVersion: '1.8.0', ...options.env } }))
      appWs.namespaces.clear()
      io = appWs.namespace('status')
      if (options.fails) {
        io.socket.respondTo('get-version-overview', { error: 'socket error' })
      } else {
        io.socket.respondTo('get-version-overview', overview(options.payload))
      }
      saveWidgets = vi.fn()
      const result = renderWithProviders(
        <UpdateInfoWidget
          widget={{ component: 'UpdateInfoWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false, dockerExpanded: false, ...options.widget }}
          resizeEvent={createWidgetEvent()}
          configureEvent={createWidgetEvent()}
          updateWidget={vi.fn()}
          saveWidgets={saveWidgets}
        />,
      )
      await settle()
      return result
    }

    async function settle() {
      await act(async () => {
        for (let tick = 0; tick < 15; tick += 1) {
          await Promise.resolve()
        }
      })
    }

    /** Click a button whose handler loads the plugin manager on demand, and wait for it. */
    async function press(element: HTMLElement) {
      fireEvent.click(element)
      await act(async () => {
        await vi.dynamicImportSettled()
      })
    }

    /** The tile whose title is `name`. */
    const tile = (name: string | RegExp) => screen.getAllByText(name)[0].closest('.hb-status-item') as HTMLElement
    const icon = (name: string | RegExp) => tile(name).querySelector('i')!.className

    beforeEach(async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      toastError = vi.spyOn((await import('@/core/ui/toast')).toast, 'error')
      modal.opened.length = 0
      modal.openModal.mockClear()
      fakes.managePlugins = {
        installAlternateVersion: vi.fn(),
        upgradeHomebridge: vi.fn(),
        // routes through the fake modal so the specs can reach the ref
        openUpdateAllModal: vi.fn(() => modal.openModal('UpdateAllModal')),
      }
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('takes the homebridge version from the payload', async () => {
      await create({ payload: { homebridge: { installedVersion: '1.9.0', updateAvailable: true } } })

      expect(tile('Homebridge')).toHaveTextContent('v1.9.0')
      expect(icon('Homebridge')).toContain(UPDATE)
    })

    it('tells the rest of the app which homebridge is running', async () => {
      // Several other pages read this rather than asking again
      await create({ payload: { homebridge: { installedVersion: '1.9.0' } } })

      expect(useSettingsStore.getState().env.homebridgeVersion).toBe('1.9.0')
      expect(useSettingsStore.getState().env.homebridgeUiVersion).toBe('5.0.0')
    })

    it('names it Homebridge, whatever the package is called', async () => {
      await create()
      await press(screen.getByRole('button', { name: 'Homebridge' }))

      expect(fakes.managePlugins.installAlternateVersion.mock.calls[0][0].displayName).toBe('Homebridge')
    })

    it.each([
      ['2.0.0', true],
      ['2.0.0-beta.7', true],
      ['10.1.0', true],
      ['1.8.0', false],
      ['1.10.0', false],
    ])('reads %s as running v2: %s', async (installedVersion, expected) => {
      // ⚠️ By major version, not by a string prefix
      await create({ payload: { homebridge: { installedVersion }, hbV2Ready: false } })

      // The readiness button is only offered before v2
      expect(!screen.queryByLabelText('status.readiness.title')).toBe(expected)
    })

    it('shows the plugins that are out of date', async () => {
      await create({ payload: { outOfDatePlugins: [{ name: 'homebridge-example' }] } })

      expect(icon('menu.label_plugins')).toContain(UPDATE)
      expect(screen.getByRole('link', { name: 'plugins.button_update' })).toHaveAttribute('href', '/plugins')
    })

    it('never counts the ui among them', async () => {
      // It has its own row in the widget
      await create({ payload: { outOfDatePlugins: [{ name: '@mp-consulting/homebridge-config-glass-ui' }] } })

      expect(icon('menu.label_plugins')).toContain(UP_TO_DATE)
      expect(screen.getByText('status.homebridge.up_to_date')).toBeInTheDocument()
    })

    it('leaves out a plugin the user muted', async () => {
      await create({
        payload: { outOfDatePlugins: [{ name: 'homebridge-example' }] },
        env: { plugins: { hideUpdatesFor: ['homebridge-example'] } },
      })

      expect(icon('menu.label_plugins')).toContain(UP_TO_DATE)
    })

    it('tells a non-admin about plugin updates without a link', async () => {
      await create({ payload: { outOfDatePlugins: [{ name: 'homebridge-example' }] }, admin: false })

      expect(screen.queryByRole('link', { name: 'plugins.button_update' })).toBeNull()
      expect(screen.getByText('plugins.button_update')).toBeInTheDocument()
    })

    it('keeps the node tile loading when the server could not check', async () => {
      // ⚠️ Not "up to date": nothing was checked
      await create({ payload: { node: null } })

      expect(icon('Node.js')).toContain(SPINNER)
      expect(tile('Node.js')).toHaveTextContent('status.homebridge.checking')
    })

    it('keeps the homebridge tile empty when the server could not check', async () => {
      await create({ payload: { homebridge: null } })

      expect(icon('Homebridge')).toContain(SPINNER)
    })

    it('finishes the docker tile when homebridge is not in docker', async () => {
      // There is nothing to check, so it must not spin for ever
      await create({ payload: { serverInfo: { homebridgeRunningInDocker: false }, docker: null }, env: { runningInDocker: true } })

      expect(icon(/Docker-Homebridge/)).toContain('fa-check-circle')
    })

    it('shows the docker version when it is', async () => {
      await create({
        env: { runningInDocker: true },
        payload: {
          serverInfo: { homebridgeRunningInDocker: true },
          docker: { currentVersion: '1.0.0', latestVersion: '2.0.0', latestReleaseBody: 'notes', updateAvailable: true },
        },
      })

      expect(tile(/Docker-Homebridge/)).toHaveTextContent('1.0.0')
      expect(icon(/Docker-Homebridge/)).toContain(UPDATE)
    })

    it('keeps the docker tile loading when that check failed', async () => {
      await create({ env: { runningInDocker: true }, payload: { serverInfo: { homebridgeRunningInDocker: true }, docker: null } })

      expect(icon(/Docker-Homebridge/)).toContain(SPINNER)
    })

    it('says nothing went wrong quietly', async () => {
      await create({ fails: true })

      expect(toastError).toHaveBeenCalled()
      expect(console.error).toHaveBeenCalled()
      expect(icon('menu.label_plugins')).toContain(SPINNER)
    })

    it('shows the npm version when the widget is set to', async () => {
      await create({ widget: { showNpmVersion: true }, payload: { node: { npmVersion: '10.0.0', updateAvailable: false } } })

      expect(tile('Node.js')).toHaveTextContent('Node.js · npm')
      expect(tile('Node.js')).toHaveTextContent('22.0.0 · 10.0.0')
    })

    describe('the v2 readiness button', () => {
      it('shows the answer the server worked out', async () => {
        await create({ payload: { hbV2Ready: false } })

        expect(screen.getByLabelText('status.readiness.title').querySelector('i')).toHaveClass('orange-text')
      })

      it('is not offered to a non-admin', async () => {
        // Only an admin can act on it
        await create({ payload: { hbV2Ready: false }, admin: false })

        expect(screen.queryByLabelText('status.readiness.title')).toBeNull()
      })

      it('is not offered once v2 is already running', async () => {
        await create({ payload: { homebridge: { installedVersion: '2.0.0' }, hbV2Ready: false } })

        expect(screen.queryByLabelText('status.readiness.title')).toBeNull()
      })

      it('is not offered when homebridge updates are muted', async () => {
        await create({ env: { homebridgeUpdatePolicy: 'none' } })

        expect(screen.queryByLabelText('status.readiness.title')).toBeNull()
      })

      it('opens the readiness modal', async () => {
        await create()

        fireEvent.click(screen.getByLabelText('status.readiness.title'))

        expect(modal.lastOpened()!.component).toBe(HbV2Modal)
        expect(modal.propsFor()).toMatchObject({ isUpdating: false, skipIfCompatible: false })
        expect(modal.lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static' })
      })
    })

    describe('the node version modal', () => {
      it('hands it everything it needs to decide what to offer', async () => {
        await create({ payload: { node: { updateAvailable: true, latestVersion: '24.0.0', showNodeUnsupportedWarning: false, architecture: 'arm64', supportsNodeJs24: true } } })

        fireEvent.click(within(tile('Node.js')).getByText('plugins.button_update'))

        expect(modal.lastOpened()!.component).toBe(NodeVersionModal)
        expect(modal.propsFor()).toMatchObject({
          nodeVersion: '22.0.0',
          latestVersion: '24.0.0',
          architecture: 'arm64',
          supportsNodeJs24: true,
        })
      })

      it('compares against the running version from the title', async () => {
        await create()

        fireEvent.click(screen.getByRole('button', { name: 'Node.js' }))

        expect(modal.propsFor()).toMatchObject({ nodeVersion: '22.0.0', latestVersion: '22.0.0' })
      })

      it('passes on where homebridge is running', async () => {
        // A synology package or a docker container cannot update node the usual way
        await create({ payload: { serverInfo: { nodeVersion: '22.0.0', homebridgeRunningInDocker: true, homebridgeRunningInSynologyPackage: true } } })

        fireEvent.click(screen.getByRole('button', { name: 'Node.js' }))

        expect(modal.propsFor()).toMatchObject({ homebridgeRunningInDocker: true, homebridgeRunningInSynologyPackage: true })
      })

      it('gives it the socket, so it can clear the version cache itself', async () => {
        await create()

        fireEvent.click(screen.getByRole('button', { name: 'Node.js' }))

        expect(modal.propsFor()!.statusIo).toBe(io)
      })

      it('re-reads the node version after an update', async () => {
        // The widget would otherwise go on showing the old version
        await create()
        fireEvent.click(screen.getByRole('button', { name: 'Node.js' }))
        io.socket.respondTo('nodejs-version-check', { updateAvailable: false, showNodeUnsupportedWarning: false })
        io.socket.respondTo('get-homebridge-server-info', { nodeVersion: '24.0.0' })

        await act(async () => {
          await modal.propsFor()!.onUpdate()
        })

        expect(tile('Node.js')).toHaveTextContent('24.0.0')
      })

      it('offers the unsupported-version notice when there is no update', async () => {
        await create({ payload: { node: { updateAvailable: false, showNodeUnsupportedWarning: true } } })

        fireEvent.click(screen.getByText('status.widget.info.node_unsupp'))

        expect(modal.propsFor()).toMatchObject({ latestVersion: '22.0.0', showNodeUnsupportedWarning: true })
      })
    })

    describe('the docker update panel', () => {
      const docker = { env: { runningInDocker: true }, payload: { serverInfo: { homebridgeRunningInDocker: true, nodeVersion: '22.0.0' } } }

      it('remembers whether the user expanded it', async () => {
        await create(docker)

        fireEvent.click(screen.getByRole('button', { name: /Docker-Homebridge/ }))

        expect(saveWidgets).toHaveBeenCalledWith({ dockerExpanded: true })
      })

      it('folds it away again', async () => {
        await create({ ...docker, widget: { dockerExpanded: true } })
        const toggle = screen.getByRole('button', { name: /Docker-Homebridge/ })
        expect(toggle).toHaveAttribute('aria-expanded', 'true')
        // Homebridge, the UI and Node.js move into the panel
        expect(document.getElementById('dockerExpandPanel')).toHaveTextContent('Homebridge Glass UI')

        fireEvent.keyDown(toggle, { key: ' ' })

        expect(saveWidgets).toHaveBeenCalledWith({ dockerExpanded: false })
      })

      it('shows the release notes in the information modal', async () => {
        await create({
          env: { runningInDocker: true },
          payload: {
            serverInfo: { homebridgeRunningInDocker: true },
            docker: { currentVersion: '1.0.0', latestVersion: '2.0.0', latestReleaseBody: 'what changed', updateAvailable: true },
          },
        })

        fireEvent.click(within(tile(/Docker-Homebridge/)).getByText('plugins.button_update'))

        expect(modal.lastOpened()!.component).toBe(Information)
        expect(modal.propsFor()).toMatchObject({ markdownMessage2: 'what changed', subtitle: '1.0.0 &rarr; 2.0.0' })
      })

      it('says the versions are unknown rather than showing an empty arrow', async () => {
        await create({ env: { runningInDocker: true }, payload: { serverInfo: { homebridgeRunningInDocker: true }, docker: { latestVersion: null, updateAvailable: true } } })

        fireEvent.click(within(tile(/Docker-Homebridge/)).getByText('plugins.button_update'))

        expect(modal.propsFor()!.subtitle).toBe('accessories.control.unknown')
      })
    })

    describe('changing a version by hand', () => {
      it('opens the version picker for the package', async () => {
        await create()

        await press(screen.getByRole('button', { name: 'Homebridge Glass UI' }))

        expect(fakes.managePlugins.installAlternateVersion).toHaveBeenCalledWith(expect.objectContaining({ name: '@mp-consulting/homebridge-config-glass-ui' }), expect.any(Function))
      })

      it('re-reads the homebridge version afterwards', async () => {
        // The row would otherwise still show the version that was replaced
        await create({ payload: { hbV2Ready: false } })
        await press(screen.getByRole('button', { name: 'Homebridge' }))
        io.socket.respondTo('homebridge-version-check', { name: 'homebridge', installedVersion: '2.0.0', updateAvailable: false })

        await act(async () => {
          await fakes.managePlugins.installAlternateVersion.mock.calls[0][1]()
        })

        expect(tile('Homebridge')).toHaveTextContent('v2.0.0')
        expect(screen.queryByLabelText('status.readiness.title')).toBeNull()
      })

      it('re-reads the ui version afterwards', async () => {
        await create()
        await press(screen.getByRole('button', { name: 'Homebridge Glass UI' }))
        io.socket.respondTo('homebridge-ui-version-check', { installedVersion: '5.1.0', updateAvailable: true })

        await act(async () => {
          await fakes.managePlugins.installAlternateVersion.mock.calls[0][1]()
        })

        expect(useSettingsStore.getState().env.homebridgeUiVersion).toBe('5.1.0')
      })

      it('says so when the version cannot be re-read', async () => {
        await create()
        await press(screen.getByRole('button', { name: 'Homebridge' }))
        io.socket.respondTo('homebridge-version-check', { error: 'socket error' })

        await act(async () => {
          await fakes.managePlugins.installAlternateVersion.mock.calls[0][1]()
        })

        expect(toastError).toHaveBeenCalled()
      })

      it('sends an update straight to the upgrade flow', async () => {
        await create({ payload: { homebridge: { name: 'homebridge', installedVersion: '1.8.0', latestVersion: '1.9.0', updateAvailable: true } } })

        await press(within(tile('Homebridge')).getByText('plugins.button_update'))

        expect(fakes.managePlugins.upgradeHomebridge).toHaveBeenCalledWith(expect.objectContaining({ name: 'homebridge' }), '1.9.0')
      })
    })

    describe('the update all button', () => {
      function allOutOfDate() {
        return {
          homebridge: { name: 'homebridge', installedVersion: '1.8.0', latestVersion: '1.9.0', updateAvailable: true },
          homebridgeUi: { name: '@mp-consulting/homebridge-config-glass-ui', installedVersion: '5.0.0', updateAvailable: true },
          outOfDatePlugins: [{ name: 'homebridge-example', displayName: 'Example', installedVersion: '1.0.0', latestVersion: '1.1.0' }],
        }
      }
      const button = () => screen.queryByLabelText('update_all.title')

      it('counts homebridge and every out-of-date plugin', async () => {
        // ⚠️ The ui's own update is forced off in anything but production, so two here
        await create({ payload: allOutOfDate() })

        expect(button()).not.toBeNull()
      })

      it('is not offered for a single update', async () => {
        // With one update the existing one-package flow is the right tool
        await create({ payload: { ...allOutOfDate(), outOfDatePlugins: [] } })

        expect(button()).toBeNull()
      })

      it('counts the ui itself only in a real build', async () => {
        const production = environment.production
        ;(environment as { production: boolean }).production = true
        try {
          await create({ payload: { ...allOutOfDate(), outOfDatePlugins: [] } })

          expect(button()).not.toBeNull()
        } finally {
          ;(environment as { production: boolean }).production = production
        }
      })

      it('is not offered to a non-admin', async () => {
        await create({ payload: allOutOfDate(), admin: false })

        expect(button()).toBeNull()
      })

      it('opens the plan modal through the shared opener', async () => {
        await create({ payload: allOutOfDate() })

        await press(button()!)

        expect(fakes.managePlugins.openUpdateAllModal).toHaveBeenCalledTimes(1)
      })

      it('reloads the widget data when the modal is closed', async () => {
        // A run that only restarts child bridges never drops the status socket
        await create({ payload: allOutOfDate() })
        const count = () => io.requests.filter(entry => entry.resource === 'get-version-overview').length
        const before = count()

        await press(button()!)
        modal.lastOpened()!.ref.close()
        await settle()

        expect(count()).toBe(before + 1)
      })

      it('does not reload on the handover close - the server is restarting', async () => {
        await create({ payload: allOutOfDate() })
        const count = () => io.requests.filter(entry => entry.resource === 'get-version-overview').length
        const before = count()

        await press(button()!)
        modal.lastOpened()!.ref.close('handover')
        await settle()

        expect(count()).toBe(before)
      })

      it('does not reload on a dismiss', async () => {
        await create({ payload: allOutOfDate() })
        const count = () => io.requests.filter(entry => entry.resource === 'get-version-overview').length
        const before = count()

        await press(button()!)
        modal.lastOpened()!.ref.dismiss('cancel')
        await settle()

        expect(count()).toBe(before)
      })
    })

    it('asks again when the socket reconnects', async () => {
      await create()
      const before = io.requests.length

      io.markConnected()
      await settle()

      expect(io.requests.length).toBe(before + 1)
    })
  })
})
