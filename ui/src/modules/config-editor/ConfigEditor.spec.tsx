import type { FakeApi, FakeOpenModal, FakeToast } from '@/testing'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Confirm } from '@/core/components/confirm/Confirm'
import { RestartChildBridges } from '@/core/components/restart-child-bridges/RestartChildBridges'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import * as toastModule from '@/core/ui/toast'
import { childBridges } from '@/core/utilities/child-bridges'
import { mobileDetect } from '@/core/utilities/mobile-detect'
import { fakeApi, makeSettingsState, setMatchMedia } from '@/testing'

import { ConfigRestore } from './config-restore/ConfigRestore'
import { Component, shouldRevalidate } from './route'

/** What the stand-in Monaco components were last rendered with, and what they hand to onMount. */
const monacoFake = vi.hoisted(() => ({
  editor: null as any,
  diffEditor: null as any,
  monaco: null as any,
  globalMonaco: undefined as any,
  editorProps: null as any,
  diffProps: null as any,
}))

vi.mock('@/core/monaco', () => ({
  MonacoEditor: function FakeMonacoEditor(props: any) {
    monacoFake.editorProps = props
    useEffect(() => {
      props.onMount?.(monacoFake.editor, monacoFake.monaco)
      // eslint-disable-next-line react/exhaustive-deps -- once, like the real editor
    }, [])
    return <div data-testid="monaco-editor" {...props.wrapperProps} />
  },
  MonacoDiffEditor: function FakeMonacoDiffEditor(props: any) {
    monacoFake.diffProps = props
    useEffect(() => {
      props.onMount?.(monacoFake.diffEditor, monacoFake.monaco)
      // eslint-disable-next-line react/exhaustive-deps -- once, like the real editor
    }, [])
    return <div data-testid="monaco-diff-editor" {...props.wrapperProps} />
  },
  getMonaco: () => monacoFake.globalMonaco,
}))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

/**
 * The config editor is the last line of defence before a broken config.json
 * reaches disk: a bad save here can stop Homebridge starting at all.
 *
 * Most specs run the page in its plain-text mode (as on a phone). That is a
 * real user path, and it means the whole validation chain is exercised without
 * Monaco, which does not run in jsdom. The Monaco cases use a stand-in editor.
 */
describe('config editor', () => {
  const modal = modalModule as unknown as FakeOpenModal
  const toast = (toastModule as unknown as { toast: FakeToast }).toast
  let api: FakeApi
  let getAllBridges: ReturnType<typeof vi.spyOn>
  let affectedBridges: any[]

  const validConfig = {
    bridge: { name: 'Homebridge', username: '0E:12:34:56:78:9A', port: 51826, pin: '031-45-154' },
    accessories: [],
    platforms: [{ platform: 'config', name: 'Config' }],
  }

  /**
   * A stand-in Monaco code editor holding `value`.
   * @param value - what its model holds
   */
  function fakeCodeEditor(value = '{}') {
    const model = {
      value,
      getValue: vi.fn(() => model.value),
      setValue: vi.fn((next: string) => {
        model.value = next
      }),
      findMatches: vi.fn(() => []),
    }
    return {
      model,
      getModel: vi.fn(() => model),
      focus: vi.fn(),
      deltaDecorations: vi.fn(() => []),
      getAction: vi.fn(() => ({ run: vi.fn(async () => {}) })),
    }
  }

  /**
   * Render the page at /config with `config` as the loader's answer.
   * @param config - config.json as the server has it
   * @param options - how to open it
   * @param options.mobile - plain-text mode (the default) or Monaco
   * @param options.search - a query string, e.g. `?action=restore`
   */
  async function open(config: Record<string, any> = validConfig, options: { mobile?: boolean, search?: string } = {}) {
    vi.spyOn(mobileDetect.detect, 'mobile').mockReturnValue((options.mobile ?? true) ? 'iPhone' : null)
    const router = createMemoryRouter([
      { path: '/config', loader: () => JSON.stringify(config, null, 4), shouldRevalidate, Component },
      { path: '*', element: <div data-testid="other-route" /> },
    ], { initialEntries: [`/config${options.search ?? ''}`] })
    const result = render(<RouterProvider router={router} />)
    await screen.findByText('menu.config_json_editor', { selector: 'h3' })
    return { ...result, router }
  }

  const textarea = () => screen.getByRole('textbox', { name: 'menu.config_json_editor' }) as HTMLTextAreaElement
  const saveButton = () => screen.getByRole('button', { name: 'form.button_save' })

  /** Let a chain of awaits settle. */
  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  /** Put text in the editor and save it, as a user typing would. */
  async function save(text?: string) {
    if (text !== undefined) {
      fireEvent.change(textarea(), { target: { value: text } })
    }
    fireEvent.click(saveButton())
    await settle()
  }

  /** The translation key of the last error the user was shown. */
  function lastError(): string | undefined {
    return toast.at('error').at(-1)?.message
  }

  beforeEach(() => {
    api = fakeApi().respond('post', /^\/config-editor/, (call: any) => ({ config: call.body, affectedBridges }))
    affectedBridges = []
    useSettingsStore.setState(makeSettingsState())
    modal.opened.length = 0
    modal.openModal.mockClear()
    toast.shown.length = 0
    getAllBridges = vi.spyOn(childBridges, 'getAll').mockResolvedValue([])
    monacoFake.editor = fakeCodeEditor()
    monacoFake.monaco = { editor: { getModelMarkers: vi.fn(() => []) } }
    monacoFake.globalMonaco = undefined
    // The page styles the layout's content wrapper on the way in and clears it on the way out
    const content = document.createElement('div')
    content.className = 'content'
    document.body.appendChild(content)
  })

  afterEach(() => {
    document.querySelector('.content')?.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('loading the config', () => {
    it('shows config.json formatted', async () => {
      await open()

      expect(textarea().value).toBe(JSON.stringify(validConfig, null, 4))
    })

    it('reads it through the route loader', async () => {
      const { loader } = await import('./route')
      api.respond('get', '/config-editor', validConfig)

      await expect(loader()).resolves.toBe(JSON.stringify(validConfig, null, 4))
    })

    it('goes back to the status page when it cannot be read', async () => {
      const { loader } = await import('./route')
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('get', '/config-editor', { status: 500, error: { message: 'disk on fire' } })

      // Without the config there is nothing to edit, and a page that mounted
      // anyway would then throw on the missing payload
      const response = await loader().catch(error => error) as Response
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/')
      expect(lastError()).toBe('disk on fire')
    })

    it('does not reload over the edits when only the query changes', () => {
      const url = (path: string) => new URL(`http://localhost${path}`)

      expect(shouldRevalidate({ currentUrl: url('/config?action=restore'), nextUrl: url('/config') } as any)).toBe(false)
      expect(shouldRevalidate({ currentUrl: url('/config'), nextUrl: url('/plugins') } as any)).toBe(true)
    })
  })

  describe('refusing a config that would break homebridge', () => {
    it.each([
      ['no bridge block at all', { platforms: [] }, 'config.config_bridge_missing'],
      ['a bridge that is not an object', { bridge: 'homebridge' }, 'config.config_bridge_missing'],
      ['a malformed bridge username', { bridge: { username: 'not-a-mac' } }, 'config.config_username_error'],
      ['accessories that are not a list', { bridge: validConfig.bridge, accessories: { first: {} } }, 'config.config_accessory_must_be_array'],
      ['platforms that are not a list', { bridge: validConfig.bridge, platforms: { first: {} } }, 'config.config_platform_must_be_array'],
      ['a platform entry that is not an object', { bridge: validConfig.bridge, platforms: ['config'] }, 'config.error_blocks_objects'],
      ['a platform entry with no platform name', { bridge: validConfig.bridge, platforms: [{ name: 'Config' }] }, 'config.error_blocks_type'],
      ['a platform name that is not text', { bridge: validConfig.bridge, platforms: [{ platform: 42 }] }, 'config.error_string_type'],
      ['an accessory entry with no accessory name', { bridge: validConfig.bridge, accessories: [{ name: 'Lamp' }] }, 'config.error_blocks_type'],
      ['a plugin list holding something other than names', { bridge: validConfig.bridge, plugins: ['homebridge-hue', 42] }, 'config.error_string_array'],
      ['a disabled plugin list holding something other than names', { bridge: validConfig.bridge, disabledPlugins: [{ name: 'homebridge-hue' }] }, 'config.error_string_array'],
    ])('refuses %s', async (_case, config, expectedError) => {
      await open()

      await save(JSON.stringify(config))

      expect(lastError()).toBe(expectedError)
      // Nothing reaches the server: the point is that the broken config never
      // gets written
      expect(api.callsTo('post', /config-editor/)).toHaveLength(0)
    })

    it('refuses text that is not json at all', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await open()

      await save('this is not json {{{')

      expect(lastError()).toBe('config.config_invalid_json')
      expect(api.callsTo('post', /config-editor/)).toHaveLength(0)
    })
  })

  describe('accepting a good config', () => {
    it('saves it', async () => {
      await open()

      await save(JSON.stringify(validConfig))

      expect(api.callsTo('post', /config-editor/)).toHaveLength(1)
      expect(api.lastCall('post', /config-editor/)?.url).toBe('/config-editor?include=restart-info')
    })

    it('accepts a config with no optional sections', async () => {
      await open()

      await save(JSON.stringify({ bridge: validConfig.bridge }))

      expect(api.callsTo('post', /config-editor/)).toHaveLength(1)
    })

    it('tidies the config before saving it', async () => {
      await open()

      await save('{"bridge":{"username":"0E:12:34:56:78:9A"},"platforms":[]}')

      // Re-indenting on save is what makes a later error easy to spot
      expect(textarea().value).toContain('\n    "bridge"')
    })

    it('accepts relaxed json and normalises it', async () => {
      await open()

      // Trailing commas and comments are what people actually paste out of a
      // plugin's readme, so they are tolerated rather than rejected
      await save(`{
        // the bridge
        "bridge": { "username": "0E:12:34:56:78:9A" },
        "platforms": [],
      }`)

      expect(api.callsTo('post', /config-editor/)).toHaveLength(1)
      expect(textarea().value).not.toContain('//')
    })

    it('says so when the server will not save it', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await open()
      api.fail('post', /^\/config-editor/, { status: 500 })

      await save()

      expect(lastError()).toBe('config.failed_to_save_config')
      expect(saveButton()).not.toBeDisabled()
    })
  })

  describe('while a save is already running', () => {
    it('ignores a second save', async () => {
      let finish: (value: unknown) => void = () => {}
      await open()
      api.respond('post', /^\/config-editor/, () => new Promise((resolve) => {
        finish = resolve
      }))

      fireEvent.click(saveButton())
      fireEvent.click(saveButton())
      await settle()

      expect(saveButton()).toBeDisabled()
      finish({ config: validConfig, affectedBridges: [] })
      await settle()

      expect(api.callsTo('post', /config-editor/)).toHaveLength(1)
      expect(saveButton()).not.toBeDisabled()
    })
  })

  describe('leaving the page', () => {
    it('lets the user leave when nothing has changed', async () => {
      const { router } = await open()

      await act(() => router.navigate('/plugins'))

      expect(screen.getByTestId('other-route')).toBeInTheDocument()
      expect(modal.openModal).not.toHaveBeenCalled()
    })

    it('asks before dropping unsaved edits, and leaves on confirm', async () => {
      const { router } = await open()
      fireEvent.change(textarea(), { target: { value: JSON.stringify({ ...validConfig, bridge: { ...validConfig.bridge, name: 'Renamed' } }) } })

      void router.navigate('/plugins')
      await settle()
      expect(modal.lastOpened()?.component).toBe(Confirm)

      // Confirming means the user accepts losing the edit
      modal.lastOpened()!.ref.close(true)
      await settle()

      expect(screen.getByTestId('other-route')).toBeInTheDocument()
    })

    it('keeps the user on the page when they change their mind', async () => {
      const { router } = await open()
      fireEvent.change(textarea(), { target: { value: '{ "half typed": ' } })

      void router.navigate('/plugins')
      await settle()
      // Text that does not even parse is certainly unsaved
      modal.lastOpened()!.ref.dismiss()
      await settle()

      expect(screen.queryByTestId('other-route')).toBeNull()
      expect(router.state.location.pathname).toBe('/config')
    })

    it('treats a reformatted but equal config as unchanged', async () => {
      const { router } = await open()
      fireEvent.change(textarea(), { target: { value: JSON.stringify(validConfig) } })

      await act(() => router.navigate('/plugins'))

      expect(screen.getByTestId('other-route')).toBeInTheDocument()
    })
  })

  /**
   * Acting on the restart decision.
   *
   * ⚠️ **Declining the prompt is not the same as not needing one.** The config is
   * already on disk either way, so a "not now" has to leave the page remembering
   * that a restart is still owed — otherwise the next save sees nothing pending
   * and the user's earlier change never gets applied.
   */
  describe('acting on the restart decision', () => {
    const bridged = (platform: string, extra: Record<string, any> = {}) => ({ platform, name: platform, _bridge: { username: '0E:11:22:33:44:55' }, ...extra })
    const withBridge = { bridge: validConfig.bridge, platforms: [{ platform: 'config', name: 'Config' }, bridged('example')] }
    const bridgeEdited = { bridge: validConfig.bridge, platforms: [{ platform: 'config', name: 'Config' }, bridged('example', { debug: true })] }

    it('says nothing needs restarting after a save that changed nothing', async () => {
      await open()

      await save()

      expect(toast.at('info').at(-1)?.title).toBe('config.config_saved')
      expect(modal.openModal).not.toHaveBeenCalled()
    })

    it('offers the full restart prompt, and will not let it be clicked away', async () => {
      await open()

      await save(JSON.stringify({ ...validConfig, bridge: { ...validConfig.bridge, name: 'Renamed' } }))

      expect(modal.lastOpened()!.component).toBe(RestartHomebridge)
      expect(modal.lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static' })
    })

    it('flags a full service restart when the ui config itself changed', async () => {
      // ⚠️ Restarting homebridge alone would not reload the UI's own settings, so
      // the change would sit on disk looking applied
      await open()

      await save(JSON.stringify({ ...validConfig, platforms: [{ platform: 'config', name: 'Config', port: 8582 }] }))

      expect(api.lastCall('put', '/platform-tools/hb-service/set-full-service-restart-flag')).toBeDefined()
      expect(modal.lastOpened()!.component).toBe(RestartHomebridge)
    })

    it('does not flag one for an ordinary config change', async () => {
      await open()

      await save(JSON.stringify({ ...validConfig, bridge: { ...validConfig.bridge, name: 'Renamed' } }))

      expect(api.callsTo('put', '/platform-tools/hb-service/set-full-service-restart-flag')).toEqual([])
    })

    it('remembers a restart is still owed when the user says not now', async () => {
      await open()
      await save(JSON.stringify({ ...validConfig, bridge: { ...validConfig.bridge, name: 'Renamed' } }))

      modal.lastOpened()!.ref.dismiss()
      await settle()
      // Saving again without a change would otherwise say "no restart needed"
      await save()

      expect(modal.opened).toHaveLength(2)
      expect(modal.lastOpened()!.component).toBe(RestartHomebridge)
    })

    it('forgets the owed restart once it is accepted', async () => {
      await open()
      await save(JSON.stringify({ ...validConfig, bridge: { ...validConfig.bridge, name: 'Renamed' } }))

      modal.lastOpened()!.ref.close()
      await settle()
      await save()

      expect(modal.opened).toHaveLength(1)
      expect(toast.at('info').at(-1)?.title).toBe('config.config_saved')
    })

    it('offers the child bridge prompt with the bridges the save reported', async () => {
      affectedBridges = [{ name: 'Example Bridge', username: '0E:11:22:33:44:55' }]
      await open(withBridge)

      await save(JSON.stringify(bridgeEdited))

      expect(modal.lastOpened()!.component).toBe(RestartChildBridges)
      expect(modal.propsFor()).toMatchObject({ bridges: [{ name: 'Example Bridge', username: '0E:11:22:33:44:55' }] })
      expect(getAllBridges).not.toHaveBeenCalled()
    })

    it('keeps the bridges queued when the user says not now', async () => {
      // ⚠️ They are still running the old config, so dropping them here would lose
      // the restart entirely
      affectedBridges = [{ name: 'Example Bridge', username: '0E:11:22:33:44:55' }]
      await open(withBridge)
      await save(JSON.stringify(bridgeEdited))

      modal.lastOpened()!.ref.dismiss()
      await settle()
      await save()

      expect(modal.lastOpened()!.component).toBe(RestartChildBridges)
      expect(modal.opened).toHaveLength(2)
    })

    it('empties the queue once the child bridges have restarted', async () => {
      affectedBridges = [{ name: 'Example Bridge', username: '0E:11:22:33:44:55' }]
      await open(withBridge)
      await save(JSON.stringify(bridgeEdited))

      modal.lastOpened()!.ref.close()
      await settle()
      await save()

      expect(modal.opened).toHaveLength(1)
    })
  })

  /**
   * The plain-text editor, which is what mobile gets and what anyone can choose.
   *
   * ⚠️ **Monaco edits only reach the page's copy of the config on save.** The
   * textarea renders from that copy, so switching to plain text has to carry
   * the current Monaco value across first — otherwise everything typed since
   * the last save disappears the moment the toggle is flipped.
   */
  describe('switching between the two editors', () => {
    async function chooseMode(label: 'config.editor_mode_plain' | 'config.editor_mode_default') {
      fireEvent.click(screen.getByRole('button', { name: 'config.editor_mode' }))
      fireEvent.click(await screen.findByRole('menuitemradio', { name: label }))
    }

    it('starts in monaco on a desktop, with the config in the model', async () => {
      await open(validConfig, { mobile: false })

      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
      expect(monacoFake.editor.model.setValue).toHaveBeenCalledWith(JSON.stringify(validConfig, null, 4))
      expect(monacoFake.editorProps.path).toBe('a://homebridge/config.json')
    })

    it('validates against the homebridge schema, for the main editor model only', async () => {
      await open(validConfig, { mobile: false })

      expect(monacoFake.editorProps.jsonSchema).toMatchObject({
        uri: 'http://homebridge/config.json',
        fileMatch: ['a://homebridge/config.json'],
        schema: { required: ['bridge'] },
      })
    })

    it('carries unsaved monaco edits into the plain text box', async () => {
      await open(validConfig, { mobile: false })
      monacoFake.editor.model.value = '{ "typed": "but not saved" }'

      await chooseMode('config.editor_mode_plain')

      expect(textarea().value).toBe('{ "typed": "but not saved" }')
    })

    it('remembers the choice for next time', async () => {
      await open(validConfig, { mobile: false })

      await chooseMode('config.editor_mode_plain')

      expect(window.localStorage.getItem('hb_config_editor_plaintext')).toBe('true')
    })

    it('opens in plain text when that was the choice', async () => {
      window.localStorage.setItem('hb_config_editor_plaintext', 'true')

      await open(validConfig, { mobile: false })

      expect(textarea()).toBeInTheDocument()
      expect(screen.queryByTestId('monaco-editor')).toBeNull()
    })

    it('remembers going back to monaco too', async () => {
      await open(validConfig, { mobile: false })
      await chooseMode('config.editor_mode_plain')

      await chooseMode('config.editor_mode_default')

      expect(window.localStorage.getItem('hb_config_editor_plaintext')).toBe('false')
    })

    it('does nothing when the editor is already the one asked for', async () => {
      await open(validConfig, { mobile: false })
      monacoFake.editor.model.getValue.mockClear()

      await chooseMode('config.editor_mode_default')

      expect(monacoFake.editor.model.getValue).not.toHaveBeenCalled()
    })

    it('still switches when the choice cannot be stored', async () => {
      // Private browsing blocks the write, and losing the toggle would be worse
      await open(validConfig, { mobile: false })
      monacoFake.editor.model.value = '{ "typed": true }'
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded')
      })

      await chooseMode('config.editor_mode_plain')

      expect(textarea().value).toBe('{ "typed": true }')
    })

    it('switches anyway when monaco cannot be read', async () => {
      await open(validConfig, { mobile: false })
      monacoFake.editor.getModel.mockImplementation(() => {
        throw new Error('editor disposed')
      })
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      await chooseMode('config.editor_mode_plain')

      expect(textarea()).toBeInTheDocument()
      expect(error).toHaveBeenCalled()
    })

    it('pushes the edited config back into monaco on the way back', async () => {
      await open(validConfig, { mobile: false })
      await chooseMode('config.editor_mode_plain')
      fireEvent.change(textarea(), { target: { value: '{ "edited": "in the textarea" }' } })
      fireEvent.click(screen.getByRole('button', { name: 'config.editor_mode' }))
      const item = await screen.findByRole('menuitemradio', { name: 'config.editor_mode_default' })
      vi.useFakeTimers()

      fireEvent.click(item)
      await act(() => vi.advanceTimersByTimeAsync(0))

      expect(monacoFake.editor.model.setValue).toHaveBeenLastCalledWith('{ "edited": "in the textarea" }')
      expect(monacoFake.editor.focus).toHaveBeenCalled()
    })
  })

  describe('saving from monaco', () => {
    it('formats the document and saves what the model holds', async () => {
      await open(validConfig, { mobile: false })
      const run = vi.fn(async () => {})
      monacoFake.editor.getAction.mockReturnValue({ run })
      monacoFake.editor.model.value = JSON.stringify({ ...validConfig, bridge: { ...validConfig.bridge, name: 'From Monaco' } })

      await save()

      expect(monacoFake.editor.getAction).toHaveBeenCalledWith('editor.action.formatDocument')
      expect(run).toHaveBeenCalled()
      expect(api.lastCall('post', /config-editor/)?.body.bridge.name).toBe('From Monaco')
    })

    it('refuses a config with a duplicate key', async () => {
      // JSON.parse would quietly keep the last one, and the other is lost
      await open(validConfig, { mobile: false })
      monacoFake.monaco.editor.getModelMarkers.mockReturnValue([{ message: 'Duplicate object key' }])

      await save()

      expect(lastError()).toBe('config.config_invalid_json')
      expect(api.callsTo('post', /config-editor/)).toHaveLength(0)
      expect(saveButton()).not.toBeDisabled()
    })

    it('saves on ctrl+s and cmd+s inside the editor', async () => {
      await open(validConfig, { mobile: false })

      fireEvent.keyDown(screen.getByTestId('monaco-editor'), { key: 's', ctrlKey: true })
      await settle()
      fireEvent.keyDown(screen.getByTestId('monaco-editor'), { key: 's', metaKey: true })
      await settle()

      expect(api.callsTo('post', /config-editor/)).toHaveLength(2)
    })

    it('puts the server-normalised config back into the model', async () => {
      await open(validConfig, { mobile: false })
      api.respond('post', /^\/config-editor/, { config: { ...validConfig, normalised: true }, affectedBridges: [] })

      await save()

      expect(monacoFake.editor.model.setValue).toHaveBeenLastCalledWith(JSON.stringify({ ...validConfig, normalised: true }, null, 4))
    })

    it('highlights the platform entry that failed the checks', async () => {
      await open(validConfig, { mobile: false })
      const range = { startLineNumber: 9, startColumn: 1, endLineNumber: 11, endColumn: 10 }
      monacoFake.editor.model.findMatches.mockReturnValue([{ range }])
      monacoFake.editor.model.value = JSON.stringify({ bridge: validConfig.bridge, platforms: [{ name: 'Nameless' }] })

      await save()
      await act(async () => {
        await new Promise(resolve => requestAnimationFrame(resolve))
      })

      expect(monacoFake.editor.model.findMatches.mock.calls[0][0]).toBe('        {\n            "name": "Nameless"\n        }')
      expect(monacoFake.editor.deltaDecorations).toHaveBeenLastCalledWith([], [
        { range, options: { isWholeLine: true, linesDecorationsClassName: 'hb-monaco-editor-line-error' } },
      ])
    })
  })

  describe('restoring an older config', () => {
    async function pickBackup(id: string) {
      modal.lastOpened()!.ref.close(id)
      await settle()
    }

    it('offers the backups from the settings page link, and clears the link', async () => {
      const { router } = await open(validConfig, { search: '?action=restore' })
      await settle()

      expect(modal.lastOpened()!.component).toBe(ConfigRestore)
      expect(modal.propsFor()).toMatchObject({ fromSettings: true })
      expect(modal.lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static' })
      // So a reload does not open it again
      expect(router.state.location.search).toBe('')
    })

    it('hands the modal the config on screen, to compare against', async () => {
      await open()
      fireEvent.change(textarea(), { target: { value: '{ "current": true }' } })

      fireEvent.click(screen.getByRole('button', { name: 'form.button_restore' }))

      expect(modal.propsFor()).toEqual({ currentConfig: '{ "current": true }', fromSettings: false })
    })

    it('loads the chosen backup into the editor, formatted', async () => {
      api.respond('get', '/config-editor/backups/12345', { bridge: { name: 'Restored' } })
      await open()

      fireEvent.click(screen.getByRole('button', { name: 'form.button_restore' }))
      await pickBackup('12345')

      expect(textarea().value).toBe('{\n    "bridge": {\n        "name": "Restored"\n    }\n}')
      // The user still has to press save
      expect(toast.at('info').at(-1)?.title).toBe('config.title_backup_loaded')
    })

    it('shows the loaded backup against the config it replaced', async () => {
      api.respond('get', '/config-editor/backups/12345', { restored: true })
      await open(validConfig, { mobile: false })
      monacoFake.diffEditor = { getModifiedEditor: () => fakeCodeEditor() }

      fireEvent.click(screen.getByRole('button', { name: 'form.button_restore' }))
      await pickBackup('12345')

      expect(screen.getByTestId('monaco-diff-editor')).toBeInTheDocument()
      expect(monacoFake.diffProps.original).toBe(JSON.stringify(validConfig, null, 4))
      expect(monacoFake.diffProps.modified).toBe('{\n    "restored": true\n}')
      expect(monacoFake.diffProps.modifiedModelPath).toBe('file:///modified.json')
    })

    it('tells the user when the backup cannot be loaded', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('get', '/config-editor/backups/12345', { status: 404 })
      await open()

      fireEvent.click(screen.getByRole('button', { name: 'form.button_restore' }))
      await pickBackup('12345')

      expect(lastError()).toBe('backup.load_error')
    })

    it('leaves the editor alone when the backup list is dismissed', async () => {
      await open()

      fireEvent.click(screen.getByRole('button', { name: 'form.button_restore' }))
      modal.lastOpened()!.ref.dismiss()
      await settle()

      expect(textarea().value).toBe(JSON.stringify(validConfig, null, 4))
      expect(screen.queryByRole('button', { name: 'form.button_cancel' })).toBeNull()
    })

    it('puts the original config back when the restore is abandoned, and offers the list again', async () => {
      api.respond('get', '/config-editor/backups/12345', { restored: true })
      await open()
      fireEvent.click(screen.getByRole('button', { name: 'form.button_restore' }))
      await pickBackup('12345')

      fireEvent.click(screen.getByRole('button', { name: 'form.button_cancel' }))

      expect(textarea().value).toBe(JSON.stringify(validConfig, null, 4))
      expect(screen.getByRole('button', { name: 'form.button_restore' })).toBeInTheDocument()
      expect(modal.opened).toHaveLength(2)
    })

    it('goes back to the editor once the restored config is saved', async () => {
      api.respond('get', '/config-editor/backups/12345', validConfig)
      await open()
      fireEvent.click(screen.getByRole('button', { name: 'form.button_restore' }))
      await pickBackup('12345')

      await save()

      expect(screen.queryByRole('button', { name: 'form.button_cancel' })).toBeNull()
    })
  })

  describe('the minimap', () => {
    afterEach(() => setMatchMedia(false))

    it('is shown on a desktop-width window', async () => {
      await open(validConfig, { mobile: false })

      expect(monacoFake.editorProps.options.minimap).toMatchObject({ enabled: true })
    })

    it('is turned off on a phone-width window, where it would take a quarter of the editor', async () => {
      setMatchMedia(true)
      await open(validConfig, { mobile: false })

      expect(monacoFake.editorProps.options.minimap).toMatchObject({ enabled: false })
    })
  })

  describe('the side by side diff', () => {
    async function openDiff() {
      api.respond('get', '/config-editor/backups/12345', { restored: true })
      await open(validConfig, { mobile: false })
      monacoFake.diffEditor = { getModifiedEditor: () => fakeCodeEditor() }
      fireEvent.click(screen.getByRole('button', { name: 'form.button_restore' }))
      modal.lastOpened()!.ref.close('12345')
      await settle()
    }

    it('turns it on and off, and tells the editor which way to render', async () => {
      await openDiff()
      expect(monacoFake.diffProps.options.renderSideBySide).toBe(false)

      fireEvent.click(screen.getByRole('button', { name: 'config.restore.view_side_by_side' }))
      expect(monacoFake.diffProps.options.renderSideBySide).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: 'config.restore.view_inline' }))
      expect(monacoFake.diffProps.options.renderSideBySide).toBe(false)
    })

    it('is not offered on a phone', async () => {
      api.respond('get', '/config-editor/backups/12345', { restored: true })
      await open()
      fireEvent.click(screen.getByRole('button', { name: 'form.button_restore' }))
      modal.lastOpened()!.ref.close('12345')
      await settle()

      expect(screen.queryByRole('button', { name: 'config.restore.view_side_by_side' })).toBeNull()
    })

    it('folds the diff back to one pane when the restore is abandoned', async () => {
      await openDiff()
      fireEvent.click(screen.getByRole('button', { name: 'config.restore.view_side_by_side' }))

      fireEvent.click(screen.getByRole('button', { name: 'form.button_cancel' }))
      // Load another backup to bring the diff back
      modal.lastOpened()!.ref.close('12345')
      await settle()

      expect(monacoFake.diffProps.options.renderSideBySide).toBe(false)
    })
  })

  /**
   * Tidying up on the way out.
   *
   * ⚠️ **Monaco's models outlive the component.** They are held globally by URI, so
   * a model left behind means the next visit builds a second one at the same URI —
   * and Monaco can then fail to attach the JSON schema to the new editor, which
   * turns off config validation with nothing on screen to say so.
   */
  describe('tidying up on the way out', () => {
    function withGlobalMonaco(present: string[]) {
      const disposed: string[] = []
      const models = new Map(present.map(uri => [uri, { isDisposed: () => disposed.includes(uri), dispose: () => disposed.push(uri) }]))
      monacoFake.globalMonaco = {
        Uri: { parse: (uri: string) => uri },
        editor: { getModel: (uri: string) => models.get(uri) },
      }
      return { disposed }
    }

    it.each([
      ['the diff view original', 'file:///original.json'],
      ['the diff view modified', 'file:///modified.json'],
      ['the main editor', 'a://homebridge/config.json'],
    ])('disposes %s model left behind', async (_case, uri) => {
      const { disposed } = withGlobalMonaco([uri])
      const { unmount } = await open()
      vi.useFakeTimers()

      unmount()
      await act(() => vi.advanceTimersByTimeAsync(0))

      expect(disposed).toEqual([uri])
    })

    it('leaves without monaco ever having loaded', async () => {
      // Plain-text mode on a phone never builds it, and throwing here would leave
      // the layout's height style behind on every other page
      const { unmount } = await open()
      vi.useFakeTimers()

      expect(() => unmount()).not.toThrow()
      await act(() => vi.advanceTimersByTimeAsync(0))
    })

    it('carries on when disposing throws', async () => {
      // ⚠️ Deliberately swallowed: a failure to tidy up must not stop the page
      // being left, or the user is stuck on it
      monacoFake.globalMonaco = {
        Uri: { parse: (uri: string) => uri },
        editor: {
          getModel: () => ({
            isDisposed: () => false,
            dispose: () => {
              throw new Error('already disposed')
            },
          }),
        },
      }
      const { unmount } = await open()
      vi.useFakeTimers()

      unmount()
      await expect(act(() => vi.advanceTimersByTimeAsync(0))).resolves.not.toThrow()
    })

    it('forgets the global editor', async () => {
      const { unmount } = await open(validConfig, { mobile: false })
      expect(window.editor).toBe(monacoFake.editor)

      unmount()

      expect(window.editor).toBeUndefined()
    })

    it('stretches the layout to fill the screen, and gives its height back', async () => {
      const { unmount } = await open()
      const content = document.querySelector<HTMLElement>('.content')!
      expect(content.style.height).toBe('100%')

      unmount()

      // Every other page would inherit that height
      expect(content.style.height).toBe('')
    })
  })
})
