import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { managePlugins } from '@/core/plugins/manage-plugins'
import { ManualConfig } from '@/core/plugins/manual-config/ManualConfig'
import { useSettingsStore } from '@/core/settings'
import { childBridges } from '@/core/utilities/child-bridges'
import { mobileDetect } from '@/core/utilities/mobile-detect'
import { fakeApi, makeEnv, makePlugin, renderWithProviders, toastStub } from '@/testing'

import '@/testing/i18n'

/**
 * The Monaco editor is a third-party subsystem with its own tests: only the
 * model's value and the validation markers matter here. The fake hands a fake
 * editor and Monaco namespace to `onMount`, and records the schema it was given.
 */
const monacoFake = vi.hoisted(() => ({
  editorValue: '',
  markers: [] as Array<{ severity: number }>,
  mounts: 0,
  jsonSchema: null as any,
  markerListeners: [] as Array<(uris: unknown[]) => void>,
}))

vi.mock('@/core/monaco', async () => {
  const { useEffect } = await import('react')
  function MonacoEditor({ onMount, jsonSchema }: { onMount: (editor: any, monaco: any) => void, jsonSchema: any }) {
    monacoFake.jsonSchema = jsonSchema
    useEffect(() => {
      monacoFake.mounts += 1
      const uri = { toString: () => 'inmemory://model/1' }
      onMount({
        getModel: () => ({
          uri,
          getValue: () => monacoFake.editorValue,
          setValue: (value: string) => {
            monacoFake.editorValue = value
          },
        }),
        getAction: () => ({ run: vi.fn() }),
        onDidChangeModelContent: vi.fn(),
      }, {
        MarkerSeverity: { Error: 8, Warning: 4 },
        editor: {
          getModelMarkers: () => monacoFake.markers,
          onDidChangeMarkers: (listener: (uris: unknown[]) => void) => {
            monacoFake.markerListeners.push(listener)
            return { dispose: vi.fn() }
          },
        },
      })
      // eslint-disable-next-line react/exhaustive-deps
    }, [])
    return <div data-testid="monaco" />
  }
  return { MonacoEditor }
})

vi.mock('@/core/plugins/manage-plugins', () => ({ managePlugins: { bridgeSettings: vi.fn(async () => undefined) } }))

const toast = vi.hoisted(() => ({ current: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

describe('the raw json editor', () => {
  let api: FakeApi
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }
  let isMobile: boolean
  let openRestart: Mock

  const schema = {
    pluginAlias: 'TestPlatform',
    pluginType: 'platform',
    strictValidation: false,
    schema: { type: 'object', properties: {} as Record<string, any> },
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toast.current = toastStub()
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    isMobile = false
    vi.spyOn(mobileDetect.detect, 'mobile').mockImplementation(() => (isMobile ? 'iPhone' : null) as any)
    openRestart = vi.fn()
    vi.spyOn(childBridges, 'openCorrectRestartModalWithBridges').mockImplementation(openRestart)
    vi.mocked(managePlugins.bridgeSettings).mockClear()
    useSettingsStore.setState({ env: makeEnv({ recommendChildBridges: true, featureFlags: {} }) })
    monacoFake.editorValue = ''
    monacoFake.markers = []
    monacoFake.mounts = 0
    monacoFake.markerListeners = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  async function open(data: Record<string, any> = {}, arrange?: () => void) {
    api = fakeApi()
    arrange?.()
    const view = renderWithProviders(
      <ManualConfig activeModal={activeModal} plugin={makePlugin()} schema={structuredClone(schema)} {...data} />,
    )
    await settle()
    return view
  }

  async function openEditor(config: any[] = [{ platform: 'TestPlatform', name: 'Kitchen' }], data: Record<string, any> = {}) {
    return open(data, () => {
      api.respond('get', '/plugins/alias/homebridge-test', { pluginAlias: 'TestPlatform', pluginType: data.pluginType ?? 'platform' })
      api.respond('get', '/config-editor/plugin/homebridge-test', config)
      // The server answers with the config it wrote, which is what the
      // first-save child bridge check reads
      api.respond('post', /^\/config-editor\/plugin\//, (call: any) => ({ config: call.body, affectedBridges: [] }))
    })
  }

  const saveButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.modal-footer .btn-primary')!
  const addButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.modal-footer .fa-plus')!.parentElement!
  const blockTitles = (container: HTMLElement) => [...container.querySelectorAll('.accordion-item h5')].map(h5 => h5.textContent)
  const openBlockId = (container: HTMLElement) => container.querySelector('.accordion-collapse.show')?.id
  const posted = () => api.lastCall('post', /include=restart-info/)?.body

  async function save(container: HTMLElement) {
    fireEvent.click(saveButton(container))
    await settle()
  }

  it('refuses to work on a phone', async () => {
    isMobile = true
    const { container, getByText } = await open()

    // Monaco is unusable on a touch keyboard, and there is no fallback here -
    // the user is pointed at the full config editor instead
    expect(getByText('plugins.settings.message_manual_config_required', { exact: false })).toBeTruthy()
    expect(container.querySelector('.fa-circle-notch')).toBeNull()
    expect(api.callsTo('get')).toHaveLength(0)
  })

  it('loads the saved blocks and opens the first', async () => {
    const { container } = await openEditor([
      { platform: 'TestPlatform', name: 'Kitchen' },
      { platform: 'TestPlatform', name: 'Garage' },
    ])

    expect(blockTitles(container)).toEqual(['Kitchen', 'Garage'])
    expect(openBlockId(container)).toBe('configBlock.0-collapse')
    expect(JSON.parse(monacoFake.editorValue)).toEqual({ platform: 'TestPlatform', name: 'Kitchen' })
  })

  it('starts a block for a plugin with no config yet', async () => {
    const { container } = await openEditor([])

    expect(blockTitles(container)).toEqual(['TestPlatform'])
    expect(JSON.parse(monacoFake.editorValue)).toEqual({ platform: 'TestPlatform', name: 'TestPlatform' })
  })

  it('gives up quietly when the plugin has no alias', async () => {
    const { container, getByText } = await open({}, () => api.respond('get', '/plugins/alias/homebridge-test', {}))

    // Without an alias there is no way to know what key the block needs, so
    // there is nothing useful to show
    expect(container.querySelector('.fa-circle-notch')).toBeNull()
    expect(getByText('plugins.settings.label_open_config_editor')).toBeTruthy()
  })

  it('uses the platforms array key for a platform plugin', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '{ "platforms": [{ "platform": "TestPlatform", "name": "A" }] }'

    await save(container)

    expect(posted()).toEqual([{ platform: 'TestPlatform', name: 'A' }])
  })

  it('uses the accessories array key for an accessory plugin', async () => {
    const { container } = await openEditor([{ accessory: 'TestPlatform', name: 'Lamp' }], { pluginType: 'accessory' })
    monacoFake.editorValue = '{ "accessories": [{ "accessory": "TestPlatform", "name": "Lamp 2" }] }'

    await save(container)

    expect(posted()).toEqual([{ accessory: 'TestPlatform', name: 'Lamp 2' }])
  })

  it('writes what the user typed back into the block', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '{ "platform": "TestPlatform", "name": "Kitchen", "lightbulbs": 3 }'

    await save(container)

    expect(posted()).toEqual([{ platform: 'TestPlatform', name: 'Kitchen', lightbulbs: 3 }])
    expect(api.lastCall('post')?.url).toBe('/config-editor/plugin/homebridge-test?include=restart-info')
  })

  it('accepts json5, so trailing commas and comments are fine', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = `{
      // the kitchen one
      "platform": "TestPlatform",
      "name": "Kitchen",
    }`

    await save(container)

    // Users paste from READMEs and from their own config.json, which
    // Homebridge itself reads with comments allowed
    expect(posted()).toEqual([{ platform: 'TestPlatform', name: 'Kitchen' }])
  })

  it('unwraps an example pasted with its platforms array', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '{ "platforms": [{ "platform": "TestPlatform", "name": "From The Readme" }] }'

    await save(container)

    // This is what a README shows, and pasting it verbatim is the single most
    // common thing users do here
    expect(posted()).toEqual([{ platform: 'TestPlatform', name: 'From The Readme' }])
  })

  it('leaves a wrapper alone when the block also has its own alias', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '{ "platform": "TestPlatform", "platforms": [{ "platform": "Other" }] }'

    // Only an object whose sole key is the array gets unwrapped, so a config
    // that genuinely has both keys is not mangled
    await save(container)

    expect(posted()).toEqual([{ platform: 'TestPlatform', platforms: [{ platform: 'Other' }] }])
  })

  it('repairs a fragment pasted without its outer braces', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '"platform": "TestPlatform", "devices": ["one"]'

    await save(container)

    expect(posted()).toEqual([{ platform: 'TestPlatform', devices: ['one'] }])
  })

  it('always puts the plugin alias back', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '{ "platform": "SomethingElse", "name": "Kitchen" }'

    await save(container)

    // Editing the alias by hand would orphan the block: Homebridge would not
    // match it to any installed plugin
    expect(posted()).toEqual([{ platform: 'TestPlatform', name: 'Kitchen' }])
  })

  it('refuses to save invalid json', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '{ "platform": '

    await save(container)

    expect(api.callsTo('post')).toHaveLength(0)
    expect(saveButton(container).disabled).toBe(false)
    expect(saveButton(container).textContent).toBe('form.button_save')
    expect(toast.current!.error.mock.calls[0][0]).toBe('config.config_invalid_json')
  })

  it('refuses to save an array', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '[{ "platform": "TestPlatform" }]'

    // The editor holds one block, not the whole list
    await save(container)

    expect(api.callsTo('post')).toHaveLength(0)
    expect(toast.current!.error.mock.calls[0][0]).toBe('plugins.config.must_be_object')
  })

  it('insists an accessory block has a name', async () => {
    const { container } = await openEditor([{ accessory: 'TestPlatform', name: 'Lamp' }], { pluginType: 'accessory' })
    monacoFake.editorValue = '{ "accessory": "TestPlatform" }'

    await save(container)

    // Homebridge will not register an accessory without one, and adding the
    // empty key shows the user where it goes
    expect(api.callsTo('post')).toHaveLength(0)
    expect(toast.current!.error.mock.calls[0][0]).toBe('plugins.config.name_property')
    expect(JSON.parse(monacoFake.editorValue).name).toBe('')
  })

  it('adds a block only when the current one is valid json', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = 'not json at all'

    fireEvent.click(addButton(container))

    // Otherwise moving to a new block would silently discard what the user
    // was part way through typing
    expect(blockTitles(container)).toHaveLength(1)
    expect(toast.current!.error.mock.calls[0][0]).toBe('config.config_invalid_json')
  })

  it('adds a block prefilled with the alias', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '{ "platform": "TestPlatform", "name": "Kitchen" }'

    fireEvent.click(addButton(container))
    await settle()

    expect(blockTitles(container)).toEqual(['Kitchen', 'TestPlatform'])
    expect(openBlockId(container)).toBe('configBlock.1-collapse')
    expect(JSON.parse(monacoFake.editorValue)).toEqual({ platform: 'TestPlatform', name: 'TestPlatform' })
  })

  it('cancels its deferred validation when the modal closes', async () => {
    // ⚠️ Opening a block schedules a re-check for when Monaco has caught up. One
    // still pending when the modal closes would run against state that no
    // longer exists
    const { container, unmount } = await openEditor([{ platform: 'TestPlatform', name: 'Kitchen' }])
    vi.useFakeTimers()
    monacoFake.editorValue = '{ "platform": "TestPlatform", "name": "Kitchen" }'
    monacoFake.markers = [{ severity: 8 }]

    fireEvent.click(addButton(container))
    unmount()

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs the deferred validation while the modal is still open', async () => {
    // The guard on the case above: without this, a component that never
    // scheduled anything would pass it
    const { container } = await openEditor([{ platform: 'TestPlatform', name: 'Kitchen' }])
    vi.useFakeTimers()
    monacoFake.editorValue = '{ "platform": "TestPlatform", "name": "Kitchen" }'

    fireEvent.click(addButton(container))
    await act(async () => {
      await Promise.resolve()
    })
    monacoFake.markers = [{ severity: 8 }]
    act(() => vi.advanceTimersByTime(1000))

    const icons = [...container.querySelectorAll('.accordion-item .fa-xl')]
    expect(icons[1].classList).toContain('fa-circle-exclamation')
  })

  it('removes a block and closes the editor', async () => {
    const { container, queryByTestId } = await openEditor([
      { platform: 'TestPlatform', name: 'Kitchen' },
      { platform: 'TestPlatform', name: 'Garage' },
    ])

    fireEvent.click(container.querySelector('.accordion-item .btn-danger')!)

    expect(blockTitles(container)).toEqual(['Garage'])
    // Nothing is being edited any more, so the editor must not keep showing
    // the block that was just deleted
    expect(openBlockId(container)).toBeUndefined()
    expect(queryByTestId('monaco')).toBeNull()
  })

  it('counts a schema error against the block being edited', async () => {
    const { container } = await openEditor()
    monacoFake.markers = [{ severity: 8 }]

    act(() => monacoFake.markerListeners.at(-1)!([{ toString: () => 'inmemory://model/1' }]))

    expect(container.querySelector('.accordion-item .fa-xl')!.className).toBe('fas fa-xl fa-circle-exclamation orange-text')
  })

  it('counts a schema warning as invalid too, and blocks a strict save', async () => {
    const { container } = await openEditor(undefined, { schema: { ...structuredClone(schema), strictValidation: true } })
    monacoFake.markers = [{ severity: 4 }]

    act(() => monacoFake.markerListeners.at(-1)!([{ toString: () => 'inmemory://model/1' }]))

    // A schema warning here means a property Homebridge will not understand
    expect(container.querySelector('.accordion-item .fa-xl')!.classList).toContain('red-text')
    expect(saveButton(container).disabled).toBe(true)
  })

  it('ignores hints and information markers', async () => {
    const { container } = await openEditor()
    monacoFake.markers = [{ severity: 1 }, { severity: 2 }]

    act(() => monacoFake.markerListeners.at(-1)!([{ toString: () => 'inmemory://model/1' }]))

    expect(container.querySelector('.accordion-item .fa-xl')!.classList).toContain('fa-circle-check')
  })

  it('ignores marker changes on another model', async () => {
    const { container } = await openEditor()
    monacoFake.markers = [{ severity: 8 }]

    act(() => monacoFake.markerListeners.at(-1)!([{ toString: () => 'inmemory://model/other' }]))

    expect(container.querySelector('.accordion-item .fa-xl')!.classList).toContain('fa-circle-check')
  })

  it('treats a block as valid when there is no editor yet', async () => {
    const { container } = await open({ schema: { ...structuredClone(schema), singular: true } }, () => {
      api.respond('get', '/plugins/alias/homebridge-test', { pluginAlias: 'TestPlatform', pluginType: 'platform' })
      api.respond('get', '/config-editor/plugin/homebridge-test', [{ platform: 'TestPlatform' }])
    })

    // Monaco loads asynchronously, so the save button must not be disabled
    // while waiting for it
    expect(container.querySelector('.modal-footer .fa-xl')!.classList).toContain('fa-circle-check')
    expect(saveButton(container).disabled).toBe(false)
  })

  it('registers the plugin schema, pinned to the alias, with the child bridge part', async () => {
    await openEditor()

    expect(monacoFake.jsonSchema.uri).toBe('http://plugin/TestPlatform/config.json')
    expect(monacoFake.jsonSchema.fileMatch).toEqual(['*'])
    expect(monacoFake.jsonSchema.schema.required).toEqual(['platform'])
    expect(monacoFake.jsonSchema.schema.properties.platform.const).toBe('TestPlatform')
    expect(monacoFake.jsonSchema.schema.properties._bridge).toBeTruthy()
  })

  it('builds a basic accessory schema for a plugin without one', async () => {
    await openEditor([{ accessory: 'TestPlatform', name: 'Lamp' }], { pluginType: 'accessory', schema: undefined })

    expect(monacoFake.jsonSchema.uri).toBe('http://plugin/TestPlatform/config.json')
    expect(monacoFake.jsonSchema.schema.required).toEqual(['accessory', 'name'])
    expect(monacoFake.jsonSchema.schema.properties.accessory.const).toBe('TestPlatform')
  })

  it('sends the user to the full editor when asked', async () => {
    isMobile = true
    const { getByText, router } = await open()

    fireEvent.click(getByText('plugins.settings.label_open_config_editor'))

    expect(router.state.location.pathname).toBe('/config')
    expect(activeModal.close).toHaveBeenCalled()
  })

  it('offers a child bridge the first time a platform is configured', async () => {
    const { container } = await openEditor([])
    monacoFake.editorValue = '{ "platform": "TestPlatform", "name": "Kitchen" }'

    await save(container)

    expect(managePlugins.bridgeSettings).toHaveBeenCalledWith(expect.objectContaining({ name: 'homebridge-test' }), true)
    expect(openRestart).not.toHaveBeenCalled()
  })

  it('asks for the right restart after a later save', async () => {
    const { container } = await openEditor()
    monacoFake.editorValue = '{ "platform": "TestPlatform", "name": "Kitchen" }'

    await save(container)

    expect(activeModal.close).toHaveBeenCalled()
    expect(openRestart).toHaveBeenCalledWith([])
    expect(managePlugins.bridgeSettings).not.toHaveBeenCalled()
  })

  it('reuses the alias and config the editor already loaded', async () => {
    const { container } = await open({
      editorContext: { alias: { pluginAlias: 'TestPlatform', pluginType: 'platform' }, config: [{ platform: 'TestPlatform', name: 'Hallway' }] },
    })

    expect(api.callsTo('get')).toHaveLength(0)
    expect(blockTitles(container)).toEqual(['Hallway'])
  })

  it('stays open when the save fails', async () => {
    const { container } = await open({}, () => {
      api.respond('get', '/plugins/alias/homebridge-test', { pluginAlias: 'TestPlatform', pluginType: 'platform' })
      api.respond('get', '/config-editor/plugin/homebridge-test', [{ platform: 'TestPlatform' }])
      api.fail('post', /^\/config-editor\/plugin\//, new Error('read only file system'))
    })
    monacoFake.editorValue = '{ "platform": "TestPlatform" }'

    await save(container)

    expect(saveButton(container).textContent).toBe('form.button_save')
    expect(activeModal.close).not.toHaveBeenCalled()
    expect(toast.current!.error.mock.calls[0][0]).toBe('config.failed_to_save_config')
  })
})
