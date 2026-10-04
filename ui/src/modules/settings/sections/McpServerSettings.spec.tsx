import type { McpStatus } from '@/core/ai/ai.interfaces'
import type { FakeApi, FakeOpenModal } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as modalModule from '@/core/ui/modal'
import { McpServerSettings, McpTokenDialog } from '@/modules/settings/sections/McpServerSettings'
import { SettingsPageContext } from '@/modules/settings/settings-page.context'
import { createSettingsPage } from '@/modules/settings/settings-page.store'
import { activeModalStub, fakeApi, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const modal = modalModule as unknown as FakeOpenModal

const TOKEN = 'generated-token-0123456789abcdefghijklmnopq'

function status(http: Partial<McpStatus['http']> = {}, extra: Partial<McpStatus> = {}): McpStatus {
  return {
    pluginInstalled: true,
    http: {
      enabled: false,
      host: '127.0.0.1',
      port: 8582,
      url: 'http://127.0.0.1:8582/mcp',
      hasToken: false,
      homebridgeUrl: '',
      defaultHomebridgeUrl: 'http://127.0.0.1:8581',
      homebridgeToken: { set: false, id: null, scope: null, exists: null },
      ...http,
    },
    snippets: {
      http: { claudeDesktop: 'desktop <your MCP token>', claudeCode: 'claude mcp add --transport http homebridge <your MCP token>', cursor: 'cursor <your MCP token>' },
      stdio: { claudeDesktop: 'desktop npx homebridge-ai-kit mcp', claudeCode: 'claude mcp add homebridge -- npx', cursor: 'cursor npx' },
    },
    ...extra,
  }
}

describe('settings: MCP server', () => {
  let api: FakeApi

  async function render(initial: McpStatus) {
    api.respond('get', '/ai/mcp', initial)
    const page = createSettingsPage({ navigate: () => {}, isPwa: false })
    renderWithProviders(
      <SettingsPageContext value={page}>
        <ul><McpServerSettings /></ul>
      </SettingsPageContext>,
    )
    await act(async () => {})
    return page
  }

  beforeEach(() => {
    api = fakeApi()
    modal.opened.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the settings with the browser\'s address for the snippets', async () => {
    await render(status())

    expect(api.lastCall('get', '/ai/mcp')?.options).toEqual({ params: { origin: window.location.origin } })
    expect(screen.getByLabelText<HTMLInputElement>('ai.mcp.enabled').checked).toBe(false)
    expect(screen.getByLabelText<HTMLInputElement>('ai.mcp.host').value).toBe('127.0.0.1')
    expect(screen.getByLabelText<HTMLInputElement>('ai.mcp.port').value).toBe('8582')
    expect(screen.getByTestId('mcp-token-state')).toHaveTextContent('ai.mcp.token_none')
    expect(screen.getByTestId('mcp-snippet')).toHaveTextContent('desktop <your MCP token>')
    expect(screen.getByText('ai.mcp.restart_note')).toBeInTheDocument()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('says when the AI Kit plugin is not installed', async () => {
    await render(status({}, { pluginInstalled: false }))
    expect(screen.getByRole('note')).toHaveTextContent('ai.mcp.plugin_missing')
  })

  it('saves the switch, a valid host and port, and not an invalid one', async () => {
    await render(status())
    api.respond('put', '/ai/mcp', status({ enabled: true }))

    await act(async () => {
      fireEvent.click(screen.getByLabelText('ai.mcp.enabled'))
    })
    expect(api.callsTo('put', '/ai/mcp')[0].body).toEqual({ enabled: true })
    expect(screen.getByLabelText<HTMLInputElement>('ai.mcp.enabled').checked).toBe(true)

    const port = screen.getByLabelText('ai.mcp.port')
    fireEvent.change(port, { target: { value: '70000' } })
    fireEvent.blur(port)
    expect(port).toHaveAttribute('aria-invalid', 'true')
    expect(api.callsTo('put', '/ai/mcp')).toHaveLength(1)

    api.respond('put', '/ai/mcp', status({ enabled: true, port: 9000 }))
    fireEvent.change(port, { target: { value: '9000' } })
    await act(async () => {
      fireEvent.blur(port)
    })
    expect(api.callsTo('put', '/ai/mcp')[1].body).toEqual({ port: 9000 })

    const host = screen.getByLabelText('ai.mcp.host')
    fireEvent.change(host, { target: { value: 'http://x/' } })
    fireEvent.blur(host)
    expect(api.callsTo('put', '/ai/mcp')).toHaveLength(2)
  })

  it('generates a token, shows it once, and offers it in the snippets only then', async () => {
    await render(status())
    api.respond('post', '/ai/mcp/token', {
      token: TOKEN,
      snippets: { claudeDesktop: `desktop ${TOKEN}`, claudeCode: `claude ${TOKEN}`, cursor: `cursor ${TOKEN}` },
      status: status({ hasToken: true }),
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ai.mcp.token_generate' }))
    })

    expect(modal.lastOpened()?.component).toBe(McpTokenDialog)
    expect(modal.propsFor()).toEqual({ token: TOKEN })
    expect(screen.getByTestId('mcp-token-state')).toHaveTextContent('ai.mcp.token_set')
    expect(screen.getByRole('button', { name: 'ai.mcp.token_regenerate' })).toBeInTheDocument()
    // The snippets carry it while it is in memory
    const include = screen.getByLabelText<HTMLInputElement>(/ai.mcp.include_token/)
    expect(include.checked).toBe(true)
    expect(screen.getByTestId('mcp-snippet')).toHaveTextContent(`desktop ${TOKEN}`)
    fireEvent.click(include)
    expect(screen.getByTestId('mcp-snippet')).toHaveTextContent('desktop <your MCP token>')
  })

  it('cannot include a token it no longer knows', async () => {
    await render(status({ hasToken: true }))
    const include = screen.getByLabelText<HTMLInputElement>(/ai.mcp.include_token/)
    expect(include.disabled).toBe(true)
    expect(screen.getByText('ai.mcp.include_token_unavailable')).toBeInTheDocument()
  })

  it('clears the token, and saves a pasted one without keeping it in the field', async () => {
    await render(status({ hasToken: true }))
    api.respond('delete', '/ai/mcp/token', status())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ai.mcp.token_clear' }))
    })
    expect(api.callsTo('delete', '/ai/mcp/token')).toHaveLength(1)
    expect(screen.getByTestId('mcp-token-state')).toHaveTextContent('ai.mcp.token_none')

    api.respond('put', '/ai/mcp', status({ hasToken: true }))
    const field = screen.getByLabelText<HTMLInputElement>('ai.mcp.token')
    fireEvent.change(field, { target: { value: 'my-own-token-0123456789' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(api.callsTo('put', '/ai/mcp')[0].body).toEqual({ token: 'my-own-token-0123456789' })
    expect(field.value).toBe('')
  })

  it('creates, replaces and removes the access token', async () => {
    await render(status())
    expect(screen.getByTestId('mcp-access-state')).toHaveTextContent('ai.mcp.access_none')

    api.respond('post', '/ai/mcp/homebridge-token', status({ homebridgeToken: { set: true, id: 't1', scope: 'read', exists: true } }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ai.mcp.access_create' }))
    })
    expect(api.callsTo('post', '/ai/mcp/homebridge-token')[0].body).toEqual({ scope: 'read' })
    expect(screen.getByTestId('mcp-access-state')).toHaveTextContent('ai.mcp.access_read')

    fireEvent.change(screen.getByLabelText('ai.mcp.access'), { target: { value: 'admin' } })
    expect(screen.getByText('users.api_tokens.scope_admin_warning')).toBeInTheDocument()
    api.respond('post', '/ai/mcp/homebridge-token', status({ homebridgeToken: { set: true, id: 't2', scope: 'admin', exists: true } }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ai.mcp.access_replace' }))
    })
    expect(api.callsTo('post', '/ai/mcp/homebridge-token')[1].body).toEqual({ scope: 'admin' })
    expect(screen.getByTestId('mcp-access-state')).toHaveTextContent('ai.mcp.access_admin')

    api.respond('delete', '/ai/mcp/homebridge-token', status())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ai.mcp.access_remove' }))
    })
    expect(screen.getByTestId('mcp-access-state')).toHaveTextContent('ai.mcp.access_none')
  })

  it('flags an access token revoked elsewhere', async () => {
    await render(status({ homebridgeToken: { set: true, id: 't1', scope: null, exists: false } }))
    expect(screen.getByTestId('mcp-access-state')).toHaveTextContent('ai.mcp.access_revoked')
  })

  it('switches between the HTTP and the local snippets, per client', async () => {
    await render(status())
    fireEvent.click(screen.getByRole('tab', { name: 'Claude Code' }))
    expect(screen.getByTestId('mcp-snippet')).toHaveTextContent('claude mcp add --transport http')

    fireEvent.click(screen.getByRole('button', { name: 'ai.mcp.transport_stdio' }))
    expect(screen.getByTestId('mcp-snippet')).toHaveTextContent('claude mcp add homebridge -- npx')
    expect(screen.queryByLabelText(/ai.mcp.include_token/)).toBeNull()
    expect(screen.getByText('ai.mcp.clients_stdio_desc')).toBeInTheDocument()

    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.a11y.copy_to_clipboard' }))
    })
    expect(writeText).toHaveBeenCalledWith('claude mcp add homebridge -- npx')
  })

  describe('the Glass UI address', () => {
    const toggle = () => screen.getByRole('button', { name: 'common.labels.advanced' })

    it('sits under Advanced, closed by default, with a word on when it is needed', async () => {
      await render(status())
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText('ai.mcp.advanced_desc')).toBeInTheDocument()
      expect(screen.queryByLabelText('ai.mcp.homebridge_url')).toBeNull()

      fireEvent.click(toggle())
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
      const field = screen.getByLabelText<HTMLInputElement>('ai.mcp.homebridge_url')
      expect(field.placeholder).toBe('http://127.0.0.1:8581')

      api.respond('put', '/ai/mcp', status({ homebridgeUrl: 'https://hb.example.com' }))
      fireEvent.change(field, { target: { value: ' https://hb.example.com ' } })
      await act(async () => {
        fireEvent.blur(field)
      })
      expect(api.callsTo('put', '/ai/mcp')[0].body).toEqual({ homebridgeUrl: 'https://hb.example.com' })

      fireEvent.click(toggle())
      expect(screen.queryByLabelText('ai.mcp.homebridge_url')).toBeNull()
    })

    it('stays closed when it holds the default the access token filled in', async () => {
      await render(status({ homebridgeUrl: 'http://127.0.0.1:8581' }))
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens by itself when one was set by hand', async () => {
      await render(status({ homebridgeUrl: 'https://hb.example.com' }))
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByLabelText<HTMLInputElement>('ai.mcp.homebridge_url').value).toBe('https://hb.example.com')
    })

    it('opens while a settings search matches it', async () => {
      const page = await render(status())
      act(() => page.onSearchChange('ai.mcp.homebridge_url'))
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
      act(() => page.clearSearch())
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    })
  })

  it('shows the generated token with a copy button', async () => {
    const activeModal = activeModalStub()
    renderWithProviders(<McpTokenDialog activeModal={activeModal as any} token={TOKEN} />)

    expect(screen.getByLabelText<HTMLInputElement>('ai.mcp.token').value).toBe(TOKEN)
    expect(screen.getByRole('alert')).toHaveTextContent('users.api_tokens.created_warning')
    fireEvent.click(screen.getByRole('button', { name: 'users.api_tokens.button_done' }))
    expect(activeModal.close).toHaveBeenCalledWith(true)
  })

  it('shows nothing until the settings are read', async () => {
    api = fakeApi().fail('get', '/ai/mcp', { status: 403, error: { message: 'Forbidden' } })
    const page = createSettingsPage({ navigate: () => {}, isPwa: false })
    renderWithProviders(
      <SettingsPageContext value={page}>
        <ul><McpServerSettings /></ul>
      </SettingsPageContext>,
    )
    await act(async () => {})
    expect(screen.queryByText('ai.mcp.title')).toBeNull()
  })
})
