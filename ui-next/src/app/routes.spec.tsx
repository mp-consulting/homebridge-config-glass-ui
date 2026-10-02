import type { RouteObject } from 'react-router'

import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, redirect, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { patchRoutesOnNavigation, PLATFORM_TOOLS_ROUTE_ID, resetRoutePatches, routes } from './routes'

const guards = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  requireLoggedOut: vi.fn(),
  setupWizardGuard: vi.fn(),
  logsGuard: vi.fn(),
}))

vi.mock('@/core/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/core/auth')>(),
  requireAuth: (args: any) => guards.requireAuth(args),
  requireAdmin: (args: any) => guards.requireAdmin(args),
  requireLoggedOut: (args: any) => guards.requireLoggedOut(args),
  setupWizardGuard: (args: any) => guards.setupWizardGuard(args),
  logsGuard: (args: any) => guards.logsGuard(args),
}))

// Hoisted with the mocks that use it
const { page } = vi.hoisted(() => ({
  // `loader` spelled out: a vitest mock throws on reading an export it lacks
  page: (name: string) => ({ Component: () => <div data-testid={name} />, loader: undefined }),
}))

vi.mock('@/shared/layout/Layout', async () => {
  const { Outlet } = await import('react-router')
  return { Layout: () => <div data-testid="layout"><Outlet /></div> }
})
vi.mock('@/app/Root', async () => {
  const { Outlet } = await import('react-router')
  return { Root: () => <Outlet /> }
})
vi.mock('@/modules/login/route', () => page('login'))
vi.mock('@/modules/setup-wizard/route', () => page('setup'))
vi.mock('@/modules/status/route', () => page('status'))
vi.mock('@/modules/restart/route', () => page('restart'))
vi.mock('@/modules/plugins/route', () => page('plugins'))
vi.mock('@/modules/config-editor/route', () => ({ ...page('config'), loader: () => ({ config: 'resolved' }) }))
vi.mock('@/modules/accessories/route', () => page('accessories'))
vi.mock('@/modules/logs/route', () => page('logs'))
vi.mock('@/modules/users/route', () => page('users'))
vi.mock('@/modules/settings/route', () => page('settings'))
vi.mock('@/modules/support/route', () => page('support'))
vi.mock('@/modules/power-options/route', () => page('power-options'))
vi.mock('@/modules/platform-tools/route', () => ({
  loader: undefined,
  children: [{ path: 'terminal', Component: () => <div data-testid="terminal" /> }],
}))

/**
 * The route table: every Angular route at the same path, behind the same guard.
 * The guards themselves are specified in core; here they are spies, so what is
 * checked is which one each route runs and what happens with its answer.
 */
describe('routes', () => {
  beforeEach(() => {
    resetRoutePatches()
    for (const spy of Object.values(guards)) {
      spy.mockReset()
      spy.mockImplementation(async () => null)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const guardedRoutes = (): RouteObject[] => routes

  async function visit(url: string) {
    const router = createMemoryRouter(guardedRoutes(), { initialEntries: [url], patchRoutesOnNavigation })
    render(<RouterProvider router={router} />)
    await act(async () => {
      await vi.waitFor(() => expect(router.state.initialized && router.state.navigation.state === 'idle').toBe(true), { timeout: 5000 })
    })
    return router
  }

  it.each([
    ['/login', 'login', 'requireLoggedOut'],
    ['/setup', 'setup', 'setupWizardGuard'],
    ['/restart', 'restart', 'requireAdmin'],
    ['/plugins', 'plugins', 'requireAuth'],
    ['/config', 'config', 'requireAdmin'],
    ['/accessories', 'accessories', 'requireAuth'],
    ['/logs', 'logs', 'logsGuard'],
    ['/users', 'users', 'requireAdmin'],
    ['/settings', 'settings', 'requireAdmin'],
    ['/support', 'support', 'requireAuth'],
    ['/power-options', 'power-options', 'requireAdmin'],
  ] as const)('%s renders its page behind %s', async (url, testId, guard) => {
    await visit(url)

    expect(screen.getByTestId(testId)).toBeInTheDocument()
    expect(guards[guard]).toHaveBeenCalled()
  })

  it('puts the home page inside the signed-in layout', async () => {
    await visit('/')

    expect(await screen.findByTestId('status')).toBeInTheDocument()
    expect(screen.getByTestId('layout')).toBeInTheDocument()
    expect(guards.requireAuth).toHaveBeenCalled()
  })

  it('keeps login and setup outside the layout', async () => {
    await visit('/login')

    expect(screen.queryByTestId('layout')).toBeNull()
  })

  it('sends an unknown url home', async () => {
    const router = await visit('/no-such-page')

    expect(router.state.location.pathname).toBe('/')
  })

  it('follows the redirect a guard answers with', async () => {
    guards.requireAdmin.mockImplementation(async () => redirect('/login'))
    const router = createMemoryRouter(guardedRoutes(), { initialEntries: ['/settings'] })
    render(<RouterProvider router={router} />)

    expect(await screen.findByTestId('login')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('runs the page resolver only after the guard lets the user in', async () => {
    const router = await visit('/config')

    const match = router.state.matches.at(-1)!
    expect(router.state.loaderData[match.route.id]).toEqual({ config: 'resolved' })
  })

  it('does not run the resolver when the guard refuses', async () => {
    guards.requireAdmin.mockImplementation(async () => redirect('/'))
    const router = createMemoryRouter(guardedRoutes(), { initialEntries: ['/config'] })
    render(<RouterProvider router={router} />)

    expect(await screen.findByTestId('status')).toBeInTheDocument()
    expect(Object.values(router.state.loaderData)).not.toContainEqual({ config: 'resolved' })
  })

  it('loads the platform tools child routes on demand', async () => {
    await visit('/platform-tools/terminal')

    expect(await screen.findByTestId('terminal')).toBeInTheDocument()
    expect(guards.requireAdmin).toHaveBeenCalled()
  })

  it('patches the platform tools routes in only once', async () => {
    const patch = vi.fn()

    await patchRoutesOnNavigation({ path: '/platform-tools/terminal', patch } as any)
    await patchRoutesOnNavigation({ path: '/platform-tools/linux/restart-server', patch } as any)

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith(PLATFORM_TOOLS_ROUTE_ID, expect.any(Array))
  })

  it('patches nothing for any other path', async () => {
    const patch = vi.fn()

    await patchRoutesOnNavigation({ path: '/platform-toolsy', patch } as any)

    expect(patch).not.toHaveBeenCalled()
  })
})
