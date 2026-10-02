import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth/auth.store'
import { pluginsCache } from '@/core/caching/plugins-cache'
import { useSettingsStore } from '@/core/settings'
import { ws as realWs } from '@/core/ws'
import { Component } from '@/modules/plugins/route'
import { fakeApi, makeAuthState, makeSettingsState, renderWithProviders, toastStub } from '@/testing'

const toast = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/plugins/manage-plugins', () => ({
  managePlugins: {
    onPluginListRefresh: { subscribe: () => () => {} },
    settings: vi.fn(),
    openUpdateAllModal: vi.fn(),
  },
}))

/** What each card was rendered with, in render order */
const cardRenders = vi.hoisted(() => [] as Array<{ name: string, isConfigured: boolean | undefined, isSearchResult: boolean }>)
vi.mock('@/modules/plugins/plugin-card/PluginCard', () => ({
  PluginCard: ({ plugin, isSearchResult }: { plugin: Plugin, isSearchResult: boolean }) => {
    cardRenders.push({ name: plugin.name, isConfigured: plugin.isConfigured, isSearchResult })
    return <div className="hb-plugin-card" data-testid="card">{plugin.name}</div>
  },
}))

const ws = realWs as unknown as FakeWs

/**
 * The page as rendered: the store behind it is covered by
 * `plugins-page.store.spec.ts`, this is the wiring and the markup.
 */
describe('pluginsPage', () => {
  let installed: Plugin[]

  function plugin(name: string, overrides: Partial<Plugin> = {}): Plugin {
    return { name, displayName: name, installedVersion: '1.0.0', latestVersion: '1.0.0', config: [], ...overrides } as Plugin
  }

  function render(options: { installed?: Plugin[], admin?: boolean, url?: string } = {}) {
    installed = options.installed ?? []
    useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }) as any)
    return renderWithProviders(<Component />, {
      route: '/plugins',
      initialEntries: [options.url ?? '/plugins'],
    })
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 20; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  beforeEach(() => {
    fakeApi()
    toast.current = toastStub()
    cardRenders.length = 0
    useSettingsStore.setState(makeSettingsState({ env: { recommendChildBridges: true } as any }))
    ws.namespaces.clear()
    ws.namespace('child-bridges').socket.respondTo('get-homebridge-child-bridge-status', [])
    vi.spyOn(pluginsCache, 'get').mockImplementation(async () => installed)
    vi.spyOn(pluginsCache, 'invalidate').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sets the page title', async () => {
    render()
    await settle()

    expect(document.title).toContain('menu.label_plugins')
  })

  it('shows a card per installed plugin, with the summary chips', async () => {
    const { container } = render({ installed: [plugin('homebridge-a', { updateAvailable: true }), plugin('homebridge-b', { disabled: true })] })
    await settle()

    expect(screen.getAllByTestId('card').map(card => card.textContent)).toEqual(['homebridge-a', 'homebridge-b'])
    expect(container.querySelectorAll('.plugin-grid > .hb-plugin-space-between')).toHaveLength(2)
    const chips = [...container.querySelectorAll('.plugin-summary .plugin-summary-chip')]
    expect(chips.map(chip => chip.className)).toEqual(['plugin-summary-chip', 'plugin-summary-chip is-update', 'plugin-summary-chip is-muted'])
  })

  it('fills in the metadata before any card renders', async () => {
    // ⚠️ A card rendered before the metadata is there flashes its "needs setup" icon
    render({ installed: [plugin('homebridge-example', { config: [{ platform: 'Example' }] })] })
    await settle()

    expect(cardRenders.length).toBeGreaterThan(0)
    expect(cardRenders.map(r => r.isConfigured)).not.toContain(undefined)
  })

  it('opens the search bar and says what to do when nothing is installed', async () => {
    const { container } = render({ installed: [] })
    await settle()

    expect(container.querySelector('#plugin-search-region input.search-bar')).not.toBeNull()
    expect(container.querySelector('.alert-info .fa-magnifying-glass')).not.toBeNull()
    expect(container.querySelector('.alert-info p')?.textContent).toBe('plugins.placeholder_search_first')
  })

  it('searches what is typed, and marks the cards as search results', async () => {
    const api = fakeApi().respond('get', /plugins\/search/, [plugin('homebridge-hue', { installedVersion: undefined as any })])
    const { container } = render({ installed: [] })
    await settle()

    const input = container.querySelector<HTMLInputElement>('input.search-bar')!
    fireEvent.change(input, { target: { value: 'hue' } })
    expect(container.querySelector('.search-bar-clear')).not.toBeNull()
    fireEvent.submit(input.closest('form')!)
    await settle()

    expect(api.lastCall('get')?.url).toBe('/plugins/search/hue')
    expect(cardRenders.at(-1)).toMatchObject({ name: 'homebridge-hue', isSearchResult: true })
    // The summary only describes the installed list
    expect(container.querySelector('.plugin-summary')).toBeNull()
  })

  it('does not re-render the cards while a query is typed', async () => {
    const { container } = render({ installed: [plugin('homebridge-a'), plugin('homebridge-b')] })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'form.search' }))
    const input = container.querySelector<HTMLInputElement>('input.search-bar')!

    cardRenders.length = 0
    fireEvent.change(input, { target: { value: 'h' } })
    fireEvent.change(input, { target: { value: 'hu' } })

    expect(input.value).toBe('hu')
    expect(cardRenders).toEqual([])
  })

  it('offers update all only from two updates', async () => {
    render({ installed: [plugin('homebridge-a', { updateAvailable: true })] })
    await settle()
    expect(screen.queryByLabelText('update_all.title')).toBeNull()
  })

  it('offers update all with two updates', async () => {
    render({ installed: [plugin('homebridge-a', { updateAvailable: true }), plugin('homebridge-b', { updateAvailable: true })] })
    await settle()

    expect(screen.getByLabelText('update_all.title')).toBeInTheDocument()
  })

  describe('who is signed in', () => {
    it('gives an admin the search and stats buttons', async () => {
      render({ installed: [plugin('homebridge-a')], admin: true })
      await settle()

      expect(screen.getByLabelText('form.search')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByLabelText('plugins.stats')).toBeInTheDocument()
      expect(screen.getByLabelText('support.title')).toBeInTheDocument()
    })

    it('gives a non-admin only the support button', async () => {
      render({ installed: [plugin('homebridge-a')], admin: false })
      await settle()

      expect(screen.queryByLabelText('form.search')).toBeNull()
      expect(screen.queryByLabelText('plugins.stats')).toBeNull()
      expect(screen.getByLabelText('support.title')).toBeInTheDocument()
    })
  })

  it('shows the stats page in place of the grid', async () => {
    const { container } = render({ installed: [plugin('homebridge-a')] })
    await settle()

    fireEvent.click(screen.getByLabelText('plugins.stats'))

    expect(container.querySelector('#stats-header')).not.toBeNull()
    expect(container.querySelector('iframe#stats-iframe.hb-stats')).toHaveAttribute('src', 'https://developers.homebridge.io/analytics/')
    expect(container.querySelector('.plugin-grid')).toBeNull()
  })

  it('clears the query parameters of a just-installed arrival', async () => {
    const { router } = render({
      installed: [plugin('homebridge-example', { config: [] })],
      url: '/plugins?action=just-installed&plugin=homebridge-example',
    })
    await settle()

    expect(router.state.location.pathname).toBe('/plugins')
    expect(router.state.location.search).toBe('')
  })

  it('closes the socket when the page is left', async () => {
    const { unmount } = render()
    await settle()

    unmount()

    expect(ws.namespace('child-bridges').end).toHaveBeenCalled()
  })

  it('holds a navigation away until the stats have faded out in light mode', async () => {
    useSettingsStore.setState({ actualLightingMode: 'light' })
    const { router } = render({ installed: [plugin('homebridge-a')] })
    await settle()
    vi.useFakeTimers()
    fireEvent.click(screen.getByLabelText('plugins.stats'))

    await act(async () => {
      void router.navigate('/accessories')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(router.state.location.pathname).toBe('/plugins')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(router.state.location.pathname).toBe('/accessories')
  })
})
