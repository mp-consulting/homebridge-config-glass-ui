import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { managePlugins } from '@/core/plugins/manage-plugins'
import { PluginConfig } from '@/core/plugins/plugin-config/PluginConfig'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { toast } from '@/core/ui/toast'
import { childBridges } from '@/core/utilities/child-bridges'
import { activeModalStub, fakeApi, makeChildBridge, makePlugin, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
vi.mock('@/core/plugins/manage-plugins', () => ({ managePlugins: { bridgeSettings: vi.fn(async () => undefined) } }))
vi.mock('@/core/utilities/child-bridges', () => ({ childBridges: { openCorrectRestartModalWithBridges: vi.fn(), invalidate: vi.fn() } }))

/** The forms rendered, newest last: the form itself is its own subsystem. */
const forms: Array<{ data: any, onValidChange?: (valid: boolean) => void, configSchema: any, lang?: string }> = []
vi.mock('@/schema-form', () => ({
  SchemaForm: (props: any) => {
    forms.push(props)
    return <div data-testid="schema-form">{props.data?.name ?? ''}</div>
  },
}))

/**
 * The generated settings form. A config block always carries the plugin's alias
 * under the right key, a first-time save may offer a child bridge, and the save
 * response says which bridges need restarting.
 */
describe('pluginConfig', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>

  const baseSchema = {
    pluginAlias: 'TestPlatform',
    pluginType: 'platform',
    strictValidation: false,
    schema: { type: 'object', properties: {} as Record<string, any> },
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  async function open(data: Record<string, any> = {}, arrange?: () => void) {
    arrange?.()
    const props = { plugin: makePlugin(), schema: structuredClone(baseSchema), ...data }
    const view = renderWithProviders(<PluginConfig activeModal={activeModal as any} {...props} />)
    await settle()
    return { ...view, props }
  }

  function openForm(config: any[] = [], data: Record<string, any> = {}) {
    return open(data, () => {
      api.respond('get', '/config-editor/plugin/homebridge-test', config)
      api.respond('post', /^\/config-editor\/plugin\//, (call: any) => ({ config: call.body, affectedBridges: [] }))
    })
  }

  const headings = () => Array.from(document.querySelectorAll('.accordion-item h5')).map(h => h.textContent)
  const panels = () => Array.from(document.querySelectorAll('.accordion-item'))
  const lastForm = () => forms.at(-1)!
  const formFor = (name: string) => [...forms].reverse().find(form => form.data?.name === name)!
  const saveButton = () => screen.getByRole('button', { name: 'form.button_save' })

  async function save() {
    fireEvent.click(saveButton())
    await settle()
  }

  async function report(form: { onValidChange?: (valid: boolean) => void }, valid: boolean) {
    await act(async () => {
      form.onValidChange!(valid)
    })
  }

  beforeEach(() => {
    forms.length = 0
    api = fakeApi()
    activeModal = activeModalStub()
    useSettingsStore.setState(makeSettingsState({ env: { recommendChildBridges: true } }))
    vi.mocked(toast.error).mockClear()
    vi.mocked(managePlugins.bridgeSettings).mockClear()
    vi.mocked(childBridges.openCorrectRestartModalWithBridges).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('turns each saved block into a panel, each with an id of its own', async () => {
    await openForm([
      { platform: 'TestPlatform', name: 'Kitchen' },
      { platform: 'TestPlatform', name: 'Garage' },
    ])

    expect(headings()).toEqual(['Kitchen', 'Garage'])
    expect(new Set(panels().map(panel => panel.id)).size).toBe(2)
  })

  it('opens the first panel so the user sees something', async () => {
    await openForm([{ platform: 'TestPlatform', name: 'Kitchen' }, { platform: 'TestPlatform', name: 'Garage' }])

    expect(screen.getAllByTestId('schema-form')).toHaveLength(1)
    expect(screen.getByTestId('schema-form')).toHaveTextContent('Kitchen')
    expect(screen.getByRole('button', { name: 'form.button_edit Kitchen' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens one panel at a time', async () => {
    await openForm([{ platform: 'TestPlatform', name: 'Kitchen' }, { platform: 'TestPlatform', name: 'Garage' }])

    fireEvent.click(screen.getByRole('button', { name: 'form.button_edit Garage' }))

    expect(screen.getAllByTestId('schema-form')).toHaveLength(1)
    expect(screen.getByTestId('schema-form')).toHaveTextContent('Garage')
  })

  it('falls back to the plugin alias when a block has no name', async () => {
    await openForm([{ platform: 'TestPlatform' }])

    expect(headings()).toEqual(['TestPlatform'])
  })

  it('starts a first block for a plugin with no config yet', async () => {
    await openForm([])

    expect(panels()).toHaveLength(1)
    // The alias has to be in the block from the start
    expect(lastForm().data).toEqual({ platform: 'TestPlatform' })
  })

  it('uses the accessory key for an accessory plugin', async () => {
    await openForm([], { schema: { ...structuredClone(baseSchema), pluginType: 'accessory' } })

    expect(lastForm().data).toEqual({ accessory: 'TestPlatform' })
  })

  it('treats a new block as invalid until the form says otherwise', async () => {
    await openForm([{ platform: 'TestPlatform', name: 'Kitchen' }])

    fireEvent.click(screen.getByRole('button', { name: 'plugins.config.add_block' }))

    const added = panels().at(-1)!
    expect(added.querySelector('.fa-circle-exclamation')).not.toBeNull()
    expect(screen.getAllByTestId('schema-form')).toHaveLength(1)
    expect(lastForm().data).toEqual({ platform: 'TestPlatform' })
  })

  it('tracks validity against the block, not its position', async () => {
    await openForm([
      { platform: 'TestPlatform', name: 'First' },
      { platform: 'TestPlatform', name: 'Second' },
      { platform: 'TestPlatform', name: 'Third' },
    ])
    await report(formFor('First'), true)
    fireEvent.click(screen.getByRole('button', { name: 'form.button_edit Second' }))
    await report(formFor('Second'), false)
    fireEvent.click(screen.getByRole('button', { name: 'form.button_edit Third' }))
    await report(formFor('Third'), true)
    fireEvent.click(screen.getByRole('button', { name: 'form.button_edit Second' }))

    fireEvent.click(screen.getByRole('button', { name: 'form.button_delete Second' }))

    expect(headings()).toEqual(['First', 'Third'])
    expect(panels().every(panel => panel.querySelector('.fa-circle-check'))).toBe(true)
  })

  it('blocks the save while a block is invalid, under strict validation', async () => {
    await openForm([{ platform: 'TestPlatform', name: 'Kitchen' }], { schema: { ...structuredClone(baseSchema), strictValidation: true } })

    await report(lastForm(), false)

    expect(saveButton()).toBeDisabled()
    expect(panels()[0].querySelector('.red-text')).not.toBeNull()
  })

  it('only warns about an invalid block without strict validation', async () => {
    await openForm([{ platform: 'TestPlatform', name: 'Kitchen' }])

    await report(lastForm(), false)

    expect(saveButton()).toBeEnabled()
    expect(panels()[0].querySelector('.orange-text')).not.toBeNull()
  })

  it('renames a panel from the name the user typed', async () => {
    await openForm([{ platform: 'TestPlatform', name: 'Kitchen' }])
    lastForm().data.name = 'Kitchen Lights'

    // Collapsing and reopening the panel picks the new name up
    fireEvent.click(screen.getByRole('button', { name: 'form.button_edit Kitchen' }))
    fireEvent.click(screen.getByRole('button', { name: 'form.button_edit Kitchen' }))

    expect(headings()).toEqual(['Kitchen Lights'])
  })

  it('closes the open panel when it is collapsed', async () => {
    await openForm([{ platform: 'TestPlatform', name: 'Kitchen' }])

    fireEvent.click(screen.getByRole('button', { name: 'form.button_edit Kitchen' }))

    expect(screen.queryByTestId('schema-form')).toBeNull()
  })

  it('saves the blocks, including what the form edited, and asks for the bridges that need restarting', async () => {
    await openForm([{ platform: 'TestPlatform', name: 'Kitchen' }])
    lastForm().data.port = 8080

    await save()

    expect(api.lastCall('post', '/config-editor/plugin/homebridge-test?include=restart-info')?.body)
      .toEqual([{ platform: 'TestPlatform', name: 'Kitchen', port: 8080 }])
    expect(activeModal.close).toHaveBeenCalled()
    expect(childBridges.openCorrectRestartModalWithBridges).toHaveBeenCalled()
  })

  it('passes the affected bridges straight through from the save response', async () => {
    const affected = [makeChildBridge()]
    await open({}, () => {
      api.respond('get', '/config-editor/plugin/homebridge-test', [{ platform: 'TestPlatform', name: 'Kitchen' }])
      api.respond('post', /^\/config-editor\/plugin\//, { config: [{ platform: 'TestPlatform' }], affectedBridges: affected })
    })

    await save()

    expect(childBridges.openCorrectRestartModalWithBridges).toHaveBeenCalledWith(affected)
  })

  it('offers a child bridge the first time a platform is configured', async () => {
    await openForm([])

    await save()

    expect(managePlugins.bridgeSettings).toHaveBeenCalledWith(expect.objectContaining({ name: 'homebridge-test' }), true)
    expect(childBridges.openCorrectRestartModalWithBridges).not.toHaveBeenCalled()
  })

  it('does not offer a child bridge when the setting is off', async () => {
    useSettingsStore.setState(makeSettingsState({ env: { recommendChildBridges: false } }))
    await openForm([])

    await save()

    expect(managePlugins.bridgeSettings).not.toHaveBeenCalled()
    expect(childBridges.openCorrectRestartModalWithBridges).toHaveBeenCalled()
  })

  it('does not offer a child bridge on a later save', async () => {
    await openForm([{ platform: 'TestPlatform', name: 'Kitchen' }])

    await save()

    expect(managePlugins.bridgeSettings).not.toHaveBeenCalled()
  })

  it('reloads its own settings when the ui config is saved', async () => {
    const getAppSettings = vi.spyOn(settingsActions, 'getAppSettings').mockResolvedValue(undefined as any)
    await open({ plugin: makePlugin({ name: '@mp-consulting/homebridge-config-glass-ui' }) }, () => {
      api.respond('get', '/config-editor/plugin/%40mp-consulting%2Fhomebridge-config-glass-ui', [{ platform: 'config' }])
      api.respond('post', /^\/config-editor\/plugin\//, { config: [{ platform: 'config' }], affectedBridges: [] })
    })

    await save()

    expect(getAppSettings).toHaveBeenCalled()
    expect(managePlugins.bridgeSettings).not.toHaveBeenCalled()
    // The ui's own config block cannot be deleted
    expect(screen.queryByRole('button', { name: /form.button_delete/ })).toBeNull()
    getAppSettings.mockRestore()
  })

  it('stays open when the save fails', async () => {
    await open({}, () => {
      api.respond('get', '/config-editor/plugin/homebridge-test', [{ platform: 'TestPlatform' }])
      api.fail('post', /^\/config-editor\/plugin\//, new Error('read only file system'))
    })

    await save()

    expect(saveButton()).toBeEnabled()
    expect(activeModal.close).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('config.failed_to_save_config', 'toast.title_error')
  })

  it('closes itself when it was opened without a schema', async () => {
    await open({ schema: null })

    expect(activeModal.dismiss).toHaveBeenCalledWith('Missing required data')
    expect(api.callsTo('get')).toHaveLength(0)
  })

  it('reuses the config the editor already loaded', async () => {
    await open({ editorContext: { config: [{ platform: 'TestPlatform', name: 'From Editor' }] } })

    expect(api.callsTo('get')).toHaveLength(0)
    expect(headings()).toEqual(['From Editor'])
  })

  it('tells the user when the config cannot be read', async () => {
    await open({}, () => api.fail('get', '/config-editor/plugin/homebridge-test', { error: { message: 'config.json is not valid json' } }))

    expect(toast.error).toHaveBeenCalledWith('config.json is not valid json', 'toast.title_error')
    expect(panels()).toHaveLength(0)
  })

  it('describes the hue bridge users so the form can render them', async () => {
    const { props } = await open({ plugin: makePlugin({ name: 'homebridge-hue' }) }, () =>
      api.respond('get', '/config-editor/plugin/homebridge-hue', [{
        platform: 'Hue',
        users: { '0017880ae670': 'abc123', '0017880ae671': 'def456' },
      }]))

    expect(Object.keys(props.schema.schema.properties.users.properties)).toEqual(['0017880ae670', '0017880ae671'])
  })

  it('copes with a hue config that has no users yet', async () => {
    const { props } = await open({ plugin: makePlugin({ name: 'homebridge-hue' }) }, () =>
      api.respond('get', '/config-editor/plugin/homebridge-hue', [{ platform: 'Hue' }]))

    expect(props.schema.schema.properties.users.properties).toEqual({})
  })

  describe('a plugin with a single config block', () => {
    const singular = () => ({ ...structuredClone(baseSchema), singular: true })

    it('shows the one form without panels, with an overall validity icon', async () => {
      await openForm([{ platform: 'TestPlatform', name: 'Only' }], { schema: singular() })

      expect(panels()).toHaveLength(0)
      expect(screen.getByTestId('schema-form')).toHaveTextContent('Only')
      expect(screen.queryByRole('button', { name: 'plugins.config.add_block' })).toBeNull()
      expect(document.querySelector('.modal-footer .fa-circle-check')).not.toBeNull()
    })

    it.each([
      ['homebridge-hue', 'homebridge-hue'],
      ['homebridge-deconz', 'homebridge-deconz'],
    ])('adds the dump download for %s', async (name) => {
      await open({ plugin: makePlugin({ name }), schema: singular() }, () =>
        api.respond('get', `/config-editor/plugin/${name}`, [{ platform: 'X' }]))

      expect(screen.getByRole('button', { name: /plugins.settings.custom.download_dump_file/ })).toBeInTheDocument()
    })
  })

  it('shows the header and footer text with the hostname filled in', async () => {
    await openForm([{ platform: 'TestPlatform' }], {
      schema: { ...structuredClone(baseSchema), headerDisplay: 'Header text', footerDisplay: 'Footer text' },
    })

    const md = Array.from(document.querySelectorAll('.plugin-md')).map(el => el.textContent?.trim())
    expect(md).toEqual(['Header text', 'Footer text'])
  })

  it('passes the user language to the form', async () => {
    useSettingsStore.setState(makeSettingsState({ env: { lang: 'de' } }))
    await openForm([{ platform: 'TestPlatform' }])

    expect(lastForm().lang).toBe('de')
  })
})
