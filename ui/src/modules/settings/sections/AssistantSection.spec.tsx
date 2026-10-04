import type { AiStatus } from '@/core/ai/ai.interfaces'
import type { FakeApi } from '@/testing'

import { act, fireEvent, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aiActions, useAiStore } from '@/core/ai/ai.store'
import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import { Settings } from '@/modules/settings/Settings'
import { fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const API_KEY = 'sk-ant-secret-key-0123456789'

function status(settings: Partial<NonNullable<AiStatus['settings']>> = {}, extra: Partial<AiStatus> = {}): AiStatus {
  return {
    enabled: false,
    reason: 'not-configured',
    provider: null,
    model: null,
    capabilities: null,
    usage: { total: { inputTokens: 1200, outputTokens: 340, calls: 3, costUsd: 0.0058 }, byModel: {} },
    settings: {
      configured: false,
      enabled: false,
      provider: 'anthropic',
      model: '',
      hasApiKey: false,
      baseUrl: '',
      maxOutputTokens: null,
      defaultModels: { 'anthropic': 'claude-sonnet-5-5', 'openai': 'gpt-5', 'gemini': 'gemini-2.5-pro', 'openai-compatible': 'llama3.1' },
      error: null,
      ...settings,
    },
    ...extra,
  }
}

// The whole settings page renders for each test: allow for a busy parallel run
describe('settings: assistant section', { timeout: 20_000 }, () => {
  let api: FakeApi

  async function render(initial: AiStatus) {
    api.respond('get', '/ai/status', initial)
    useSettingsStore.setState(makeSettingsState())
    renderWithProviders(
      <Settings deps={{ isPwa: false, bootLocale: 'en', terminal: { hasActiveSession: () => false, destroyPersistentSession: async () => {} } }} />,
      { route: '/settings' },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    return within(document.getElementById('settings-section-assistant')!)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    resetSettingsStore()
    aiActions.reset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsActions, 'setPageTitle').mockImplementation(() => {})
    api = fakeApi()
      .respond('get', '/platform-tools/hb-service/homebridge-startup-settings', {})
      .respond('get', '/server/network-interfaces/system', [])
      .respond('get', '/server/network-interfaces/bridge', [])
      .respond('get', '/server/mdns-advertiser', { advertiser: 'ciao' })
      .respond('get', '/server/port', { port: 51826 })
      .respond('get', '/server/ports', { start: 52100, end: 52200 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is listed in the settings index', async () => {
    await render(status())
    expect([...document.querySelectorAll('.settings-nav-item span')].map(span => span.textContent)).toContain('ai.settings.title')
  })

  it('turns the Assistant on', async () => {
    const section = await render(status())
    expect(section.getByText('ai.settings.reason_not_configured')).toBeInTheDocument()
    api.respond('put', '/ai/settings', status({ configured: true, enabled: true, hasApiKey: false }, { reason: 'missing-api-key' }))

    await act(async () => {
      fireEvent.click(section.getByLabelText('ai.settings.enabled'))
    })

    expect(api.lastCall('put', '/ai/settings')?.body).toEqual({ enabled: true })
    expect(section.getByText('ai.settings.reason_missing_api_key')).toBeInTheDocument()
  })

  it('sends the API key once, then forgets it', async () => {
    const section = await render(status({ configured: true, enabled: true }))
    api.respond('put', '/ai/settings', status({ configured: true, enabled: true, hasApiKey: true }, { enabled: true, reason: null, provider: 'anthropic', model: 'claude-sonnet-5-5' }))
    const input = section.getByLabelText('ai.settings.api_key')
    expect(input).toHaveAttribute('type', 'password')

    fireEvent.change(input, { target: { value: API_KEY } })
    await act(async () => {
      fireEvent.blur(input)
    })

    expect(api.lastCall('put', '/ai/settings')?.body).toEqual({ apiKey: API_KEY })
    expect(input).toHaveValue('')
    expect(section.getByText('ai.settings.api_key_stored')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(API_KEY)
    // Every entry point now sees the Assistant as on
    expect(useAiStore.getState().status?.enabled).toBe(true)

    // An empty field saves nothing
    api.clearCalls()
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(api.callsTo('put')).toHaveLength(0)
  })

  it('removes a stored key', async () => {
    const section = await render(status({ configured: true, enabled: true, hasApiKey: true }))
    api.respond('put', '/ai/settings', status({ configured: true, enabled: true, hasApiKey: false }))
    await act(async () => {
      fireEvent.click(section.getByRole('button', { name: 'ai.settings.api_key_remove' }))
    })
    expect(api.lastCall('put', '/ai/settings')?.body).toEqual({ clearApiKey: true })
  })

  it('switches provider and shows the base URL for a local server', async () => {
    const section = await render(status({ configured: true }))
    expect(section.queryByLabelText('ai.settings.base_url')).toBeNull()
    api.respond('put', '/ai/settings', status({ configured: true, provider: 'openai-compatible' }))

    await act(async () => {
      fireEvent.change(section.getByLabelText('ai.settings.provider'), { target: { value: 'openai-compatible' } })
    })

    expect(api.lastCall('put', '/ai/settings')?.body).toEqual({ provider: 'openai-compatible', model: '' })
    const baseUrl = section.getByLabelText('ai.settings.base_url')
    fireEvent.change(baseUrl, { target: { value: 'http://127.0.0.1:11434/v1' } })
    await act(async () => {
      fireEvent.blur(baseUrl)
    })
    expect(api.lastCall('put', '/ai/settings')?.body).toEqual({ baseUrl: 'http://127.0.0.1:11434/v1' })
  })

  it('tests the connection and shows the usage', async () => {
    const section = await render(status({ configured: true, enabled: true, hasApiKey: true }))
    expect(section.getByTestId('ai-usage')).toHaveTextContent('ai.settings.usage_calls')
    api.respond('post', '/ai/test', { ok: false, message: '401 invalid key' })

    await act(async () => {
      fireEvent.click(section.getByRole('button', { name: /ai.settings.test_button/ }))
    })

    expect(api.callsTo('post', '/ai/test')).toHaveLength(1)
    expect(section.getByText('ai.settings.test_failed')).toBeInTheDocument()
  })
})
