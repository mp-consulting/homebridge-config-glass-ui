import type { AiStatus } from '@/core/ai/ai.interfaces'
import type { FakeIoNamespace, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aiActions } from '@/core/ai/ai.store'
import { ConfigCopilot } from '@/core/ai/copilot/ConfigCopilot'
import { UpdateRiskBriefing } from '@/core/ai/update-risk/UpdateRiskBriefing'
import { useAuthStore } from '@/core/auth'
import { ws as realWs } from '@/core/ws'
import { withCopilotBlock } from '@/modules/config-editor/config-copilot'
import { activeModalStub, fakeApi, makeAuthState, makeUser, renderWithProviders } from '@/testing'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
// Monaco does not run in jsdom: the diff's two sides are shown as text
vi.mock('@/core/monaco', () => ({
  MonacoDiffEditor: ({ original, modified }: { original: string, modified: string }) => (
    <div>
      <pre data-testid="diff-original">{original}</pre>
      <pre data-testid="diff-modified">{modified}</pre>
    </div>
  ),
}))

const ws = realWs as unknown as FakeWs

const CURRENT = { platform: 'Ring', name: 'Ring', password: 'secret', refresh: 60 }
const GENERATED = { platform: 'Ring', name: 'Ring', password: 'secret', refresh: 30 }

describe('config copilot', () => {
  let io: FakeIoNamespace

  beforeEach(() => {
    ws.namespaces.clear()
    io = ws.namespace('ai')
    io.socket.respondTo('plugin-config', (payload: any) => ({ requestId: payload.requestId, accepted: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function generate(request = 'Refresh every 30 seconds') {
    fireEvent.change(screen.getByLabelText('ai.copilot.describe'), { target: { value: request } })
    fireEvent.click(screen.getByRole('button', { name: /ai.copilot.generate/ }))
    const { requestId, body } = io.requests.at(-1)!.payload
    await act(async () => {
      io.socket.fire('ai:done', { requestId, result: { config: GENERATED, explanation: 'Polls every **30** seconds.', current: CURRENT, index: 0 } })
    })
    return body
  }

  it('shows the generated block as a diff and applies it', async () => {
    const activeModal = activeModalStub()
    renderWithProviders(<ConfigCopilot activeModal={activeModal as any} pluginName="homebridge-ring" pluginLabel="Ring" current={CURRENT} />)
    expect(screen.getByRole('button', { name: /ai.copilot.generate/ })).toBeDisabled()

    const body = await generate()

    expect(body).toEqual({ pluginName: 'homebridge-ring', request: 'Refresh every 30 seconds', current: CURRENT })
    expect(screen.getByTestId('diff-original')).toHaveTextContent('"refresh": 60')
    expect(screen.getByTestId('diff-modified')).toHaveTextContent('"refresh": 30')
    expect(screen.getByText('30').tagName).toBe('STRONG')
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ai.copilot.apply' }))
    expect(activeModal.close).toHaveBeenCalledWith({ config: GENERATED, modified: JSON.stringify(GENERATED, null, 4) })
  })

  it('rejects the result and goes back to the request', async () => {
    const activeModal = activeModalStub()
    renderWithProviders(<ConfigCopilot activeModal={activeModal as any} pluginName="homebridge-ring" current={CURRENT} />)
    await generate()

    fireEvent.click(screen.getByRole('button', { name: 'ai.copilot.reject' }))

    expect(screen.queryByTestId('diff-modified')).toBeNull()
    expect(activeModal.close).not.toHaveBeenCalled()
    expect(screen.getByLabelText('ai.copilot.describe')).toHaveValue('Refresh every 30 seconds')
  })

  it('lets the config editor pick the plugin and diff the whole config', async () => {
    const activeModal = activeModalStub()
    const before = { bridge: {}, accessories: [], platforms: [{ platform: 'config' }, CURRENT] }
    renderWithProviders(
      <ConfigCopilot
        activeModal={activeModal as any}
        pluginChoices={[{ name: 'homebridge-hue', label: 'Hue' }, { name: 'homebridge-ring', label: 'Ring' }]}
        buildDiff={result => ({ original: JSON.stringify(before), modified: JSON.stringify(withCopilotBlock(before as any, result.config)) })}
      />,
    )
    fireEvent.change(screen.getByLabelText('ai.copilot.plugin'), { target: { value: 'homebridge-ring' } })
    const body = await generate()

    expect(body).toEqual({ pluginName: 'homebridge-ring', request: 'Refresh every 30 seconds' })
    fireEvent.click(screen.getByRole('button', { name: 'ai.copilot.apply' }))
    const { modified } = activeModal.close.mock.calls[0][0]
    expect(JSON.parse(modified).platforms).toEqual([{ platform: 'config' }, GENERATED])
  })

  it('shows why generation failed', async () => {
    renderWithProviders(<ConfigCopilot activeModal={activeModalStub() as any} pluginName="homebridge-ring" />)
    fireEvent.change(screen.getByLabelText('ai.copilot.describe'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /ai.copilot.generate/ }))
    const { requestId } = io.requests.at(-1)!.payload
    await act(async () => {
      io.socket.fire('ai:error', { requestId, message: 'The AI provider failed.', status: 502 })
    })
    expect(screen.getByRole('alert')).toHaveTextContent('The AI provider failed.')
  })
})

describe('withCopilotBlock', () => {
  const config = {
    bridge: { name: 'HB' },
    accessories: [{ accessory: 'Fan', name: 'Fan' }],
    platforms: [{ platform: 'config' }, { platform: 'Hue', name: 'Upstairs' }, { platform: 'Hue', name: 'Downstairs' }],
  } as any

  it('replaces the block with the same name, else the first of the plugin', () => {
    expect(withCopilotBlock(config, { platform: 'Hue', name: 'Downstairs', x: 1 }).platforms?.[2]).toEqual({ platform: 'Hue', name: 'Downstairs', x: 1 })
    expect(withCopilotBlock(config, { platform: 'Hue', name: 'Attic' }).platforms?.[1]).toEqual({ platform: 'Hue', name: 'Attic' })
  })

  it('appends a new plugin and handles accessories, leaving the input alone', () => {
    const next = withCopilotBlock(config, { platform: 'Ring', name: 'Ring' })
    expect(next.platforms).toHaveLength(4)
    expect(withCopilotBlock(config, { accessory: 'Fan', name: 'Fan', speed: 2 }).accessories).toEqual([{ accessory: 'Fan', name: 'Fan', speed: 2 }])
    expect(config.platforms).toHaveLength(3)
  })
})

describe('update risk briefing', () => {
  const enabled = { enabled: true, reason: null } as AiStatus

  beforeEach(() => {
    useAuthStore.setState(makeAuthState({ user: makeUser({ admin: true }) }))
    aiActions.setStatus(enabled)
  })

  it('assesses on demand and shows the risk', async () => {
    const api = fakeApi().respond('post', '/ai/update-risk', {
      pluginName: 'homebridge-ring',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
      risk: 'high',
      summary: 'A breaking rename.',
      breakingChanges: ['host is now address'],
      hasChangelog: true,
      cached: false,
    })
    renderWithProviders(<UpdateRiskBriefing pluginName="homebridge-ring" currentVersion="1.0.0" targetVersion="2.0.0" />)
    expect(api.calls).toHaveLength(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ai.update_risk.assess/ }))
    })

    expect(api.lastCall('post', '/ai/update-risk')?.body).toEqual({ pluginName: 'homebridge-ring', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    expect(screen.getByText('ai.update_risk.high')).toBeInTheDocument()
    expect(screen.getByText('A breaking rename.')).toBeInTheDocument()
    expect(screen.getByText('host is now address')).toBeInTheDocument()
  })

  it('is hidden while the Assistant is off, and for a non-admin', () => {
    aiActions.setStatus({ ...enabled, enabled: false })
    const { container, rerender } = renderWithProviders(<UpdateRiskBriefing pluginName="homebridge-ring" />)
    expect(container).toBeEmptyDOMElement()

    aiActions.setStatus(enabled)
    useAuthStore.setState(makeAuthState({ user: makeUser({ admin: false }) }))
    rerender(<UpdateRiskBriefing pluginName="homebridge-ring" />)
    expect(container).toBeEmptyDOMElement()
  })
})
