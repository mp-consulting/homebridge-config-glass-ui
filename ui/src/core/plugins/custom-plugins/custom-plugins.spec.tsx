import type { FakeApi, FakeIoNamespace, FakeOpenModal, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cachedAccessoriesCache } from '@/core/caching/cached-accessories-cache'
import { customPlugins } from '@/core/plugins/custom-plugins/custom-plugins.service'
import { CustomPlugins } from '@/core/plugins/custom-plugins/CustomPlugins'
import { managePlugins } from '@/core/plugins/manage-plugins'
import { useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import * as modalModule from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { childBridges } from '@/core/utilities/child-bridges'
import { ws as realWs } from '@/core/ws'
import { environment } from '@/environments/environment'
import { activeModalStub, fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/plugins/manage-plugins', () => ({ managePlugins: { bridgeSettings: vi.fn() } }))
vi.mock('@/core/utilities/child-bridges', () => ({ childBridges: { openCorrectRestartModalWithBridges: vi.fn() } }))
vi.mock('@/core/caching/cached-accessories-cache', async () => ({ cachedAccessoriesCache: (await import('@/testing')).cachedAccessoriesStub() }))

/** The schema forms rendered, newest last: the form itself is its own subsystem. */
const forms: any[] = []
vi.mock('@/schema-form', () => ({
  SchemaForm: (props: any) => {
    forms.push(props)
    return <div data-testid="schema-form" />
  },
}))

const ws = realWs as unknown as FakeWs
const modal = modalModule as unknown as FakeOpenModal
const accessoryCache = cachedAccessoriesCache as unknown as { getHap: ReturnType<typeof vi.fn>, getMatter: ReturnType<typeof vi.fn> }

/**
 * The custom plugin UI host.
 *
 * This is the one screen where third-party code runs inside the app, in an
 * iframe that talks to it over `postMessage`. Two things therefore matter more
 * here than anywhere else:
 *
 * - **the guard on incoming messages.** Any page in any tab can post to this
 *   window; only messages whose `source` is this modal's own iframe and whose
 *   origin is the API's may be acted on.
 * - **the shape of every reply.** The plugin UI's own promise chain is waiting
 *   on it, so a reply that never arrives (or that cannot be structured-cloned)
 *   hangs the plugin's settings screen with no error anywhere.
 */
describe('the custom plugin ui', () => {
  let api: FakeApi
  let io: FakeIoNamespace
  let activeModal: ReturnType<typeof activeModalStub>
  let view: ReturnType<typeof renderWithProviders>
  /** The iframe's contentWindow, standing in for the plugin's own page. */
  let pluginWindow: { postMessage: ReturnType<typeof vi.fn> }
  let iframe: HTMLIFrameElement
  let pluginConfig: Array<Record<string, unknown>>

  const plugin = { name: 'homebridge-example', installedVersion: '1.2.3' } as any

  function makeSchema(overrides: Record<string, any> = {}) {
    return {
      pluginAlias: 'Example',
      pluginType: 'platform',
      strictValidation: false,
      customUi: true,
      ...overrides,
    }
  }

  interface OpenOptions {
    schema?: Record<string, any> | undefined
    pluginConfig?: Array<Record<string, unknown>>
    recommendChildBridges?: boolean
    hapCache?: any[]
    matterCache?: any[]
    arrange?: () => void
    strict?: boolean
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  async function open(options: OpenOptions = {}) {
    useSettingsStore.setState(makeSettingsState({ env: { recommendChildBridges: options.recommendChildBridges ?? false } }))
    accessoryCache.getHap.mockImplementation(async () => options.hapCache ?? [])
    accessoryCache.getMatter.mockImplementation(async () => options.matterCache ?? [])
    pluginConfig = options.pluginConfig ?? [{ platform: 'Example', name: 'Example' }]
    options.arrange?.()

    const modalView = (
      <CustomPlugins
        activeModal={activeModal as any}
        plugin={plugin}
        schema={'schema' in options ? options.schema : makeSchema()}
        pluginConfig={pluginConfig}
      />
    )
    view = renderWithProviders(options.strict ? <StrictMode>{modalView}</StrictMode> : modalView)
    await settle()

    iframe = document.querySelector('iframe')!
    pluginWindow = { postMessage: vi.fn() }
    if (iframe) {
      Object.defineProperty(iframe, 'contentWindow', { value: pluginWindow, configurable: true })
    }
  }

  /** Let the socket report ready, which is what makes the iframe load. */
  async function ready() {
    await act(async () => {
      io.socket.fire('ready')
    })
    await settle()
  }

  async function post(data: Record<string, unknown>, overrides: { source?: unknown, origin?: string } = {}) {
    const event = {
      source: 'source' in overrides ? overrides.source : pluginWindow,
      origin: overrides.origin ?? environment.api.origin,
      data,
    }
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('message'), event))
    })
    await settle()
    return event
  }

  function replies() {
    return pluginWindow.postMessage.mock.calls.map(call => call[0])
  }

  function lastReply() {
    return replies().filter(reply => reply?.action === 'response').at(-1)
  }

  const spinners = () => document.querySelectorAll('.modal-body > .fa-spin, .modal-body .my-5 .fa-spin').length
  const lastForm = () => forms.at(-1)

  beforeEach(() => {
    forms.length = 0
    api = fakeApi()
      .respond('post', /\/plugins\/settings-ui\/.*\/ticket$/, { ticket: 'test-ticket' })
      .respond('post', /\/plugins\/settings-ui\/.*\/session\/revoke$/, {})
    ws.namespaces.clear()
    io = ws.namespace('plugins/settings-ui')
    activeModal = activeModalStub()
    for (const level of ['success', 'error', 'warning', 'info'] as const) {
      vi.mocked(toast[level]).mockClear()
    }
    vi.mocked(managePlugins.bridgeSettings).mockClear()
    vi.mocked(childBridges.openCorrectRestartModalWithBridges).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
    vi.mocked(console.warn).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('starting up', () => {
    it('dismisses rather than rendering when no schema was provided', async () => {
      await open({ schema: undefined })

      expect(activeModal.dismiss).toHaveBeenCalledWith('Missing required data')
      expect(console.error).toHaveBeenCalled()
      expect(io.socket.payloadsFor('start')).toEqual([])
    })

    it('introduces the plugin to the server on every connection', async () => {
      // The server-side helper dies with the socket, so `start` has to be
      // re-sent on a reconnect - and sent exactly once per connection
      await open()

      expect(io.socket.payloadsFor('start')).toEqual(['homebridge-example'])

      io.connected.next()
      expect(io.socket.payloadsFor('start')).toEqual(['homebridge-example', 'homebridge-example'])
    })

    it('loads the iframe from a one-off ticket once the helper is ready', async () => {
      await open()
      expect(spinners()).toBe(1)

      await ready()

      expect(spinners()).toBe(0)
      expect(api.lastCall('post')?.url).toBe('/plugins/settings-ui/homebridge-example/ticket')
      const src = new URL(iframe.src, location.origin)
      expect(src.pathname).toBe('/api/plugins/settings-ui/homebridge-example/index.html')
      expect(src.searchParams.get('ticket')).toBe('test-ticket')
      expect(src.searchParams.get('v')).toBe('1.2.3')
    })

    it('does not reload the iframe when the helper reports ready again', async () => {
      await open()
      await ready()
      const first = iframe.src

      await ready()

      expect(iframe.src).toBe(first)
      expect(api.callsTo('post', '/plugins/settings-ui/homebridge-example/ticket')).toHaveLength(1)
    })

    it('says the plugin ui is offline when the ticket cannot be issued', async () => {
      await open({ arrange: () => api.fail('post', /ticket$/, new Error('helper died')) })

      await ready()

      expect(spinners()).toBe(0)
      expect(toast.error).toHaveBeenCalledWith('plugins.settings.message_ui_offline', 'toast.title_error')
    })

    it('ends up with one live session under StrictMode', async () => {
      // StrictMode mounts, unmounts and mounts again: the throwaway mount must
      // leave no listener, no window handler and no revoke behind it
      await open({ strict: true })

      expect(io.socket.handlers('ready')).toHaveLength(1)
      expect(io.socket.handlers('response')).toHaveLength(1)
      expect(api.callsTo('post', /session\/revoke$/)).toHaveLength(0)

      await ready()
      await post({ action: 'config.get', requestId: 'r1' })

      expect(replies().filter(reply => reply?.action === 'response')).toHaveLength(1)
    })
  })

  /**
   * Making the plugin's own page look like the rest of the UI.
   *
   * ⚠️ **The iframe is a separate document with none of the app's styling.**
   * (The message building itself is covered by custom-ui-styles.spec.ts.)
   */
  describe('styling the plugin page', () => {
    function bodyClasses() {
      return replies().filter(reply => reply?.action === 'body-class').map(reply => reply.class)
    }

    it('sends the theme, modal, dark mode and glass mode classes across', async () => {
      document.body.classList.add('glass-ui-teal', 'dark-mode', 'glass-mode')
      await open()
      await ready()

      await post({ action: 'loaded' })

      expect(bodyClasses()).toEqual(['glass-ui-teal', 'modal-content', 'dark-mode', 'glass-mode'])
    })

    it('leaves the dark mode class off in light mode', async () => {
      await open()
      await ready()

      await post({ action: 'loaded' })

      expect(bodyClasses()).not.toContain('dark-mode')
    })

    it('passes the parent stylesheets over as absolute urls', async () => {
      const link = document.createElement('link')
      link.setAttribute('rel', 'stylesheet')
      link.setAttribute('href', '/styles.css')
      document.head.appendChild(link)
      await open()
      await ready()

      await post({ action: 'loaded' })

      const hrefs = replies().filter(reply => reply?.action === 'link-element').map(reply => reply.href)
      expect(hrefs).toContain(`${document.baseURI}styles.css`)
      link.remove()
    })

    it('passes the parent inline styles over too', async () => {
      const style = document.createElement('style')
      style.innerHTML = '.from-the-parent { color: red; }'
      document.head.appendChild(style)
      await open()
      await ready()

      await post({ action: 'loaded' })

      const styles = replies().filter(reply => reply?.action === 'inline-style').map(reply => reply.style)
      expect(styles.some((css: string) => css.includes('from-the-parent'))).toBe(true)
      style.remove()
    })

    it('confirms it is ready once the styling has gone across, to the page origin', async () => {
      await open()
      await ready()

      await post({ action: 'loaded' })

      const actions = replies().map(reply => reply?.action)
      expect(actions.at(-1)).toBe('ready')
      expect(pluginWindow.postMessage.mock.calls.every(call => call[1] === environment.api.origin)).toBe(true)
    })
  })

  describe('the guard on incoming messages', () => {
    it('ignores a message from another window', async () => {
      // ⚠️ Assert on the foreign window's own postMessage: replies go to
      // `event.source`, so checking the iframe received nothing passes even
      // with the source check removed
      await open()
      await ready()
      const foreign = { postMessage: vi.fn() }

      await post({ action: 'config.get', requestId: 'r1' }, { source: foreign })

      expect(foreign.postMessage).not.toHaveBeenCalled()
      expect(lastReply()).toBeUndefined()
    })

    it('ignores a message that claims the right origin from the wrong window', async () => {
      await open()
      await ready()
      const foreign = { postMessage: vi.fn() }

      await post({ action: 'config.save', requestId: 'r1' }, { source: foreign })

      expect(foreign.postMessage).not.toHaveBeenCalled()
      expect(api.callsTo('post', /config-editor\/plugin/)).toEqual([])
    })

    it('ignores a message from a foreign origin', async () => {
      await open()
      await ready()

      await post({ action: 'config.get', requestId: 'r1' }, { origin: 'https://not-homebridge.example' })

      expect(lastReply()).toBeUndefined()
    })

    it('ignores everything before the iframe has been given its page', async () => {
      await open()

      await post({ action: 'config.get', requestId: 'r1' })

      expect(lastReply()).toBeUndefined()
    })

    it('answers a message from its own iframe, from the page origin too', async () => {
      await open()
      await ready()

      await post({ action: 'config.get', requestId: 'r1' }, { origin: window.origin })

      expect(lastReply()).toMatchObject({ action: 'response', requestId: 'r1', success: true })
      expect(pluginWindow.postMessage.mock.calls.at(-1)![1]).toBe(window.origin)
    })
  })

  describe('reading and writing the config', () => {
    it('hands over the config blocks on request', async () => {
      await open({ pluginConfig: [{ platform: 'Example', name: 'Front Room' }] })
      await ready()

      await post({ action: 'config.get', requestId: 'r1' })

      expect(lastReply()?.data).toEqual([{ platform: 'Example', name: 'Front Room' }])
    })

    it('hands over the schema on request', async () => {
      await open()
      await ready()

      await post({ action: 'config.schema', requestId: 'r1' })

      expect(lastReply()?.data).toMatchObject({ pluginAlias: 'Example' })
    })

    it('answers a save only once it has actually saved', async () => {
      // Replying with the promise itself throws DataCloneError (#2869)
      await open({ arrange: () => api.respond('post', /config-editor\/plugin/, { config: [{ platform: 'Example' }], affectedBridges: [] }) })
      await ready()

      await post({ action: 'config.save', requestId: 'r1' })

      expect(api.lastCall('post', /config-editor\/plugin/)?.url).toBe('/config-editor/plugin/homebridge-example?include=restart-info')
      const reply = lastReply()
      expect(reply?.success).toBe(true)
      expect(reply?.data).toEqual(pluginConfig)
      expect(reply?.data).not.toBeInstanceOf(Promise)
      // A save from the page does not close the modal
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('tells the plugin the save failed rather than leaving it waiting', async () => {
      await open({ arrange: () => api.fail('post', /config-editor\/plugin/, new Error('disk full')) })
      await ready()

      await post({ action: 'config.save', requestId: 'r1' })

      expect(lastReply()).toMatchObject({ requestId: 'r1', success: false })
      expect(lastReply()?.data).toEqual({ message: 'config.failed_to_save_config' })
    })

    it.each([
      ['not an array', { platform: 'Example' }, 'plugins.config.must_be_array'],
      ['entries that are not objects', ['not an object'], 'plugins.config.must_be_array_objects'],
      // `typeof [] === 'object'`, so this needs its own check
      ['entries that are arrays', [[]], 'plugins.config.must_be_array_objects'],
    ])('refuses a config update with %s', async (_label, update, key) => {
      await open()
      await ready()

      await post({ action: 'config.update', requestId: 'r1', pluginConfig: update })

      expect(lastReply()).toMatchObject({ success: false, data: { message: key } })
      expect(toast.error).toHaveBeenCalledWith(key, 'toast.title_error')
    })

    it('stamps the alias onto every block the plugin sends', async () => {
      await open()
      await ready()

      await post({ action: 'config.update', requestId: 'r1', pluginConfig: [{ name: 'One' }, { name: 'Two' }] })

      expect(pluginConfig).toEqual([
        { platform: 'Example', name: 'One' },
        { platform: 'Example', name: 'Two' },
      ])
      expect(lastReply()).toMatchObject({ success: true, data: pluginConfig })
    })

    it('stamps an accessory plugin as an accessory', async () => {
      await open({ schema: makeSchema({ pluginType: 'accessory' }), pluginConfig: [] })
      await ready()

      await post({ action: 'config.update', requestId: 'r1', pluginConfig: [{ name: 'One' }] })

      expect(pluginConfig[0]).toEqual({ accessory: 'Example', name: 'One' })
    })

    it('merges into the existing block rather than replacing it', async () => {
      // Deliberate: the array and its objects keep their identity so the
      // form bound to them is not reset on every plugin update
      await open({ pluginConfig: [{ platform: 'Example', name: 'One', legacyOption: true }] })
      await ready()
      const blockBefore = pluginConfig[0]

      await post({ action: 'config.update', requestId: 'r1', pluginConfig: [{ name: 'Renamed' }] })

      expect(pluginConfig[0]).toBe(blockBefore)
      expect(pluginConfig[0]).toEqual({ platform: 'Example', name: 'Renamed', legacyOption: true })
    })

    it('drops blocks the plugin removed', async () => {
      await open({ pluginConfig: [{ platform: 'Example', name: 'One' }, { platform: 'Example', name: 'Two' }] })
      await ready()

      await post({ action: 'config.update', requestId: 'r1', pluginConfig: [{ name: 'One' }] })

      expect(pluginConfig).toHaveLength(1)
    })
  })

  describe('what the plugin can read about the app', () => {
    it('tells the plugin which language the user is on', async () => {
      await open()
      await ready()

      await post({ action: 'i18n.lang', requestId: 'r1' })

      expect(lastReply()?.data).toBe(i18n.language)
    })

    it('hands over the whole flat translation file', async () => {
      await open()
      await ready()

      await post({ action: 'i18n.translations', requestId: 'r1' })

      expect(lastReply()?.data).toMatchObject({ 'menu.label_settings': expect.any(String) })
    })

    it('falls back to english for a language the app does not ship', async () => {
      await open()
      await ready()
      await act(async () => {
        await i18n.changeLanguage('kl')
      })

      await post({ action: 'i18n.translations', requestId: 'r1' })

      expect(lastReply()?.data).toMatchObject({ 'menu.label_settings': expect.any(String) })
      await act(async () => {
        await i18n.changeLanguage('cimode')
      })
    })

    it('reports the lighting mode the user is actually seeing', async () => {
      await open()
      useSettingsStore.setState({ actualLightingMode: 'dark' })
      await ready()

      await post({ action: 'user.lightingMode', requestId: 'r1' })

      expect(lastReply()?.data).toBe('dark')
    })
  })

  describe('sizing the plugin page', () => {
    it('grows the iframe to fit what the plugin rendered', async () => {
      await open()
      await ready()

      await post({ action: 'scrollHeight', scrollHeight: 640 })

      expect(iframe.style.height).toBe('650px')
    })
  })

  describe('proxying requests to the server helper', () => {
    it('forwards a request over the socket', async () => {
      await open()
      await ready()

      await post({ action: 'request', requestId: 'r1', path: '/do-thing' })

      expect(io.socket.payloadsFor('request')).toEqual([{ action: 'request', requestId: 'r1', path: '/do-thing' }])
    })

    it('fails fast instead of buffering a request while the socket is down', async () => {
      await open()
      await ready()
      io.socket.connected = false

      await post({ action: 'request', requestId: 'r1', path: '/do-thing' })

      expect(io.socket.payloadsFor('request')).toEqual([])
      expect(lastReply()).toMatchObject({ requestId: 'r1', success: false, data: { message: 'plugins.settings.message_ui_offline' } })
    })

    it('passes a response from the helper into the iframe', async () => {
      await open()
      await ready()

      io.socket.fire('response', { requestId: 'r1', data: 'hello' })

      expect(pluginWindow.postMessage).toHaveBeenCalledWith({ requestId: 'r1', data: 'hello', action: 'response' }, environment.api.origin)
    })

    it('passes a stream event from the helper into the iframe', async () => {
      await open()
      await ready()

      io.socket.fire('stream', { event: 'progress', data: 42 })

      expect(pluginWindow.postMessage).toHaveBeenCalledWith({ event: 'progress', data: 42, action: 'stream' }, environment.api.origin)
    })
  })

  describe('the cached accessory lists', () => {
    it('gives the plugin only its own hap accessories', async () => {
      await open({ hapCache: [{ plugin: 'homebridge-example', displayName: 'Mine' }, { plugin: 'homebridge-other', displayName: 'Theirs' }] })
      await ready()

      await post({ action: 'cachedAccessories.get', requestId: 'r1' })

      expect(lastReply()?.data).toEqual([{ plugin: 'homebridge-example', displayName: 'Mine' }])
    })

    it('gives the plugin only its own matter accessories', async () => {
      await open({ matterCache: [{ plugin: 'homebridge-example', displayName: 'Mine' }, { plugin: 'homebridge-other', displayName: 'Theirs' }] })
      await ready()

      await post({ action: 'cachedMatterAccessories.get', requestId: 'r1' })

      expect(lastReply()?.data).toEqual([{ plugin: 'homebridge-example', displayName: 'Mine' }])
    })

    it.each([
      ['hap', 'getHap', 'cachedAccessories.get'],
      ['matter', 'getMatter', 'cachedMatterAccessories.get'],
    ] as const)('toasts rather than throwing when the %s cache is unreachable', async (_case, method, action) => {
      await open()
      await ready()
      accessoryCache[method].mockRejectedValueOnce(new Error('cache down'))

      await post({ action, requestId: 'r1' })

      expect(toast.error).toHaveBeenCalledWith('toast.title_error')
    })
  })

  describe('what the plugin can drive in the surrounding ui', () => {
    it.each(['success', 'error', 'warning', 'info'] as const)('shows a %s toast', async (level) => {
      await open()
      await ready()

      await post({ action: `toast.${level}`, message: 'Plugin says hello', title: 'Example' })

      expect(toast[level]).toHaveBeenCalledWith('Plugin says hello', 'Example')
    })

    it('shows and hides the spinner', async () => {
      await open()
      await ready()

      await post({ action: 'spinner.show' })
      expect(document.querySelector('.loading-overlay')).not.toBeNull()

      await post({ action: 'spinner.hide' })
      expect(document.querySelector('.loading-overlay')).toBeNull()
    })

    it('disables and re-enables the save button, hiding the validity icon meanwhile', async () => {
      await open()
      await ready()

      await post({ action: 'button.save.disabled' })
      expect(screen.getByRole('button', { name: 'form.button_save' })).toBeDisabled()
      expect(document.querySelector('.modal-footer .fa-xl')).toBeNull()

      await post({ action: 'button.save.enabled' })
      expect(screen.getByRole('button', { name: 'form.button_save' })).toBeEnabled()
    })

    it('shows the generated form only once the page has loaded, for a singular schema', async () => {
      await open({ schema: makeSchema({ singular: true }) })
      await ready()

      await post({ action: 'schema.show' })
      expect(screen.queryByTestId('schema-form')).toBeNull()

      await post({ action: 'scrollHeight', scrollHeight: 100 })
      expect(screen.getByTestId('schema-form')).toBeInTheDocument()
      expect(lastForm().data).toBe(pluginConfig[0])

      await post({ action: 'schema.hide' })
      expect(screen.queryByTestId('schema-form')).toBeNull()
    })

    it('hides the generated form while a custom form is up', async () => {
      // Two forms at once would both write to the same config
      await open({ schema: makeSchema({ singular: true }) })
      await ready()
      await post({ action: 'scrollHeight', scrollHeight: 100 })
      await post({ action: 'schema.show' })

      await post({
        action: 'form.create',
        formId: 'pairing',
        schema: { type: 'object' },
        data: { code: '' },
        submitButton: 'Pair',
        cancelButton: 'Back',
      })

      expect(screen.getAllByTestId('schema-form')).toHaveLength(1)
      expect(lastForm().configSchema).toEqual({ type: 'object' })
      expect(screen.getByRole('button', { name: 'Pair' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    })

    it('clears the custom form when the plugin ends it', async () => {
      await open()
      await ready()
      await post({ action: 'form.create', formId: 'pairing', schema: {}, data: {} })

      await post({ action: 'form.end' })
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(screen.queryByTestId('schema-form')).toBeNull()
    })

    it('disables submit while the custom form is invalid', async () => {
      await open()
      await ready()
      await post({ action: 'form.create', formId: 'pairing', schema: {}, data: {}, submitButton: 'Pair' })

      await act(async () => {
        lastForm().onValidChange(false)
      })

      expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled()
    })

    describe('what a custom form sends back', () => {
      async function withForm() {
        await open()
        await ready()
        await post({ action: 'form.create', formId: 'pairing', schema: { type: 'object' }, data: { code: '' }, submitButton: 'Pair', cancelButton: 'Back' })
        pluginWindow.postMessage.mockClear()
      }

      function streams() {
        return pluginWindow.postMessage.mock.calls
          .map(call => ({ message: call[0], targetOrigin: call[1] }))
          .filter(entry => entry.message?.action === 'stream')
      }

      it('streams edits back under the form id the plugin chose', async () => {
        await withForm()
        vi.useFakeTimers()

        // ⚠️ `skip(1)` sits AFTER the debounce, so what is dropped is the
        // first value to settle - the form reporting the data the plugin
        // just handed it - rather than the first keystroke
        lastForm().onDataChanged({ code: '' })
        vi.advanceTimersByTime(200)
        expect(streams()).toEqual([])

        lastForm().onDataChanged({ code: '1234' })
        vi.advanceTimersByTime(200)

        expect(streams().map(entry => entry.message)).toEqual([{
          action: 'stream',
          event: 'pairing',
          data: { formEvent: 'change', formData: { code: '1234' } },
        }])
      })

      it('sends only the last edit of a burst of typing', async () => {
        await withForm()
        vi.useFakeTimers()
        lastForm().onDataChanged({ code: '' })
        vi.advanceTimersByTime(200)

        lastForm().onDataChanged({ code: '1' })
        vi.advanceTimersByTime(50)
        lastForm().onDataChanged({ code: '12' })
        vi.advanceTimersByTime(50)
        lastForm().onDataChanged({ code: '123' })
        vi.advanceTimersByTime(200)

        expect(streams().map(entry => entry.message.data.formData)).toEqual([{ code: '123' }])
      })

      it.each([['submit', 'Pair'], ['cancel', 'Back']] as const)('tells the plugin page the form was %sed, with what it holds', async (formEvent, label) => {
        await withForm()
        const data = { code: '1234' }
        await act(async () => {
          lastForm().onDataChange(data)
        })

        fireEvent.click(screen.getByRole('button', { name: label }))

        expect(streams().map(entry => entry.message)).toEqual([{
          action: 'stream',
          event: 'pairing',
          data: { formEvent, formData: { code: '1234' } },
        }])
        // A wildcard target origin would hand pairing codes to any window
        expect(streams().map(entry => entry.targetOrigin)).toEqual([environment.api.origin])
      })
    })

    it('closes the modal on request, revoking the session first', async () => {
      await open()
      await ready()

      await post({ action: 'close' })

      expect(api.callsTo('post', /session\/revoke$/)).toHaveLength(1)
      expect(activeModal.close).toHaveBeenCalled()
    })
  })

  /**
   * Keeping the generated form and the plugin's own page in step.
   *
   * ⚠️ **Both edit the same config, so an echo is easy to create.** The plugin
   * writes a value, the generated form redraws, the redraw looks like a user
   * edit, and the edit is posted straight back to the plugin. The one-shot flag
   * is what breaks that loop.
   */
  describe('keeping the two forms in step', () => {
    async function settleForms() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
    }

    function echoedConfigChanges() {
      return pluginWindow.postMessage.mock.calls.filter(([message]) => message?.event === 'configChanged')
    }

    async function withGeneratedForm() {
      await open({ schema: makeSchema({ singular: true }), pluginConfig: [{ name: 'Example' }] })
      await ready()
      await post({ action: 'scrollHeight', scrollHeight: 100 })
      await post({ action: 'schema.show' })
      vi.useFakeTimers()
      pluginWindow.postMessage.mockClear()
    }

    it('tells the plugin when the generated form is edited, but not as it is built', async () => {
      await withGeneratedForm()

      lastForm().onDataChanged({})
      await settleForms()
      expect(echoedConfigChanges()).toHaveLength(0)

      lastForm().onDataChanged({})
      await settleForms()

      expect(pluginWindow.postMessage).toHaveBeenCalledWith(
        { action: 'stream', event: 'configChanged', data: pluginConfig },
        environment.api.origin,
      )
    })

    it('redraws the form with the new values when the plugin changes the config, and does not echo the redraw', async () => {
      await withGeneratedForm()
      lastForm().onDataChanged({})
      await settleForms()
      const before = pluginConfig[0]

      await post({ action: 'config.update', requestId: 'r1', pluginConfig: [{ name: 'From plugin' }] })
      await settleForms()

      // A new object, so the form takes the values instead of keeping its own
      expect(pluginConfig[0]).not.toBe(before)
      expect(lastForm().data).toBe(pluginConfig[0])
      expect(lastForm().data).toEqual({ platform: 'Example', name: 'From plugin' })
      pluginWindow.postMessage.mockClear()

      lastForm().onDataChanged({})
      await settleForms()
      expect(echoedConfigChanges()).toHaveLength(0)

      lastForm().onDataChanged({})
      await settleForms()
      expect(echoedConfigChanges()).toHaveLength(1)
    })

    it('keeps the form edits in the shared config', async () => {
      await withGeneratedForm()
      const edited = { platform: 'Example', name: 'Typed' }

      lastForm().onDataChange(edited)

      expect(pluginConfig[0]).toBe(edited)
    })
  })

  describe('saving from the modal footer', () => {
    const saveButton = () => screen.getByRole('button', { name: 'form.button_save' })

    async function save() {
      fireEvent.click(saveButton())
      await settle()
    }

    it('offers a child bridge the first time a platform plugin is configured', async () => {
      await open({
        pluginConfig: [],
        recommendChildBridges: true,
        arrange: () => api.respond('post', /config-editor\/plugin/, { config: [{ platform: 'Example' }], affectedBridges: [] }),
      })
      await ready()

      await save()

      expect(activeModal.close).toHaveBeenCalled()
      expect(managePlugins.bridgeSettings).toHaveBeenCalledWith(plugin, true)
      expect(childBridges.openCorrectRestartModalWithBridges).not.toHaveBeenCalled()
      expect(api.callsTo('post', /session\/revoke$/)).toHaveLength(1)
    })

    it('goes straight to the restart prompt on a later save', async () => {
      const affectedBridges = [{ identifier: 'bridge-1' }]
      await open({
        recommendChildBridges: true,
        arrange: () => api.respond('post', /config-editor\/plugin/, { config: [{ platform: 'Example' }], affectedBridges }),
      })
      await ready()

      await save()

      expect(childBridges.openCorrectRestartModalWithBridges).toHaveBeenCalledWith(affectedBridges)
      expect(managePlugins.bridgeSettings).not.toHaveBeenCalled()
    })

    it('does not offer a child bridge when the setting is off', async () => {
      await open({
        pluginConfig: [],
        recommendChildBridges: false,
        arrange: () => api.respond('post', /config-editor\/plugin/, { config: [{ platform: 'Example' }], affectedBridges: [] }),
      })
      await ready()

      await save()

      expect(managePlugins.bridgeSettings).not.toHaveBeenCalled()
      expect(childBridges.openCorrectRestartModalWithBridges).toHaveBeenCalled()
    })

    it('stays open and toasts when the save fails', async () => {
      await open({ arrange: () => api.fail('post', /config-editor\/plugin/, new Error('disk full')) })
      await ready()

      await save()

      expect(saveButton()).toBeEnabled()
      expect(activeModal.close).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('config.failed_to_save_config', 'toast.title_error')
    })

    it('shows the strict validity of the generated form', async () => {
      await open({ schema: makeSchema({ singular: true, strictValidation: true }) })
      await ready()
      await post({ action: 'scrollHeight', scrollHeight: 100 })
      await post({ action: 'schema.show' })

      await act(async () => {
        lastForm().onValidChange(false)
      })

      expect(document.querySelector('.modal-footer .fa-circle-exclamation.red-text')).not.toBeNull()
    })
  })

  describe('tearing down', () => {
    it('revokes the asset session when dismissed', async () => {
      await open()
      await ready()

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[1])
      await settle()

      expect(api.lastCall('post', /session\/revoke$/)?.options).toEqual({ withCredentials: true })
      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })

    it('revokes the asset session only once', async () => {
      await open()
      await ready()

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[1])
      await settle()
      view.unmount()
      await settle()

      expect(api.callsTo('post', /session\/revoke$/)).toHaveLength(1)
    })

    it('revokes the asset session on an escape-key dismissal', async () => {
      await open()
      await ready()

      view.unmount()
      await settle()

      expect(api.callsTo('post', /session\/revoke$/)).toHaveLength(1)
    })

    it('revokes this plugin\'s asset session with credentials when destroyed', async () => {
      // Destroy (unmount) is the one path every close shares - the cookie-backed asset session
      // must not outlive the modal
      await open()
      await ready()
      expect(api.callsTo('post', /session\/revoke$/)).toHaveLength(0)

      view.unmount()
      await settle()

      const revoke = api.lastCall('post', /session\/revoke$/)
      expect(revoke?.url).toBe('/plugins/settings-ui/homebridge-example/session/revoke')
      expect(revoke?.options).toEqual({ withCredentials: true })
    })

    it('closes anyway when the session cannot be revoked', async () => {
      await open({ arrange: () => api.fail('post', /session\/revoke$/, new Error('server gone')) })
      await ready()

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[1])
      await settle()

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
      expect(console.warn).toHaveBeenCalled()
    })

    it('detaches its socket listeners before ending the connection', async () => {
      // The socket is cached and outlives this modal (#2873)
      await open()
      await ready()

      view.unmount()
      await settle()

      expect(io.socket.handlers('response')).toEqual([])
      expect(io.socket.handlers('stream')).toEqual([])
      expect(io.socket.handlers('ready')).toEqual([])
      expect(io.end).toHaveBeenCalled()
      io.connected.next()
      expect(io.socket.payloadsFor('start')).toHaveLength(1)
    })

    it('stops listening for messages from the page', async () => {
      await open()
      await ready()
      const before = pluginWindow.postMessage.mock.calls.length

      view.unmount()
      await settle()
      await post({ action: 'config.get', requestId: 'r1' })

      expect(pluginWindow.postMessage.mock.calls).toHaveLength(before)
    })
  })
})

describe('customPlugins', () => {
  let api: FakeApi
  const plugin = { name: 'homebridge-example', installedVersion: '1.2.3' } as any
  const schema = { pluginAlias: 'Example', pluginType: 'platform', customUi: true }

  async function settle() {
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve()
    }
  }

  beforeEach(() => {
    api = fakeApi().respond('get', /config-editor\/plugin/, [{ platform: 'Example', name: 'Loaded' }])
    modal.opened.length = 0
    customPlugins.plugins = {}
  })

  it('opens the component a plugin registered for itself', async () => {
    const FakeCustomComponent = () => null
    customPlugins.plugins['homebridge-example'] = FakeCustomComponent

    void customPlugins.openSettings(plugin, schema)
    await settle()

    expect(modal.lastOpened()!.component).toBe(FakeCustomComponent)
    expect(modal.lastOpened()!.options).toMatchObject({ backdrop: 'static', size: 'lg' })
  })

  it('opens the generic iframe host for everything else', async () => {
    void customPlugins.openCustomSettingsUi(plugin, schema)
    await settle()

    expect(modal.lastOpened()!.component).toBe(CustomPlugins)
  })

  it('fetches the current config when the caller has none', async () => {
    void customPlugins.openCustomSettingsUi(plugin, schema)
    await settle()

    expect(api.lastCall('get')?.url).toBe('/config-editor/plugin/homebridge-example')
    expect(modal.lastOpened()!.props?.pluginConfig).toEqual([{ platform: 'Example', name: 'Loaded' }])
  })

  it('uses the config the caller already had, without a round trip', async () => {
    const editorContext = { config: [{ platform: 'Example', name: 'Unsaved edit' }] } as any

    void customPlugins.openCustomSettingsUi(plugin, schema, editorContext)
    await settle()

    expect(api.callsTo('get')).toEqual([])
    expect(modal.lastOpened()!.props).toMatchObject({ pluginConfig: [{ platform: 'Example', name: 'Unsaved edit' }], editorContext })
  })

  it('encodes a scoped plugin name in the url', async () => {
    void customPlugins.openCustomSettingsUi({ name: '@scope/homebridge-example', installedVersion: '1.0.0' } as any, schema)
    await settle()

    expect(api.lastCall('get')?.url).toBe('/config-editor/plugin/%40scope%2Fhomebridge-example')
  })

  it('resolves quietly when the modal is dismissed', async () => {
    const opening = customPlugins.openCustomSettingsUi(plugin, schema)
    await settle()
    modal.lastOpened()!.ref.dismiss('Dismiss')

    await expect(opening).resolves.toBeUndefined()
  })
})
