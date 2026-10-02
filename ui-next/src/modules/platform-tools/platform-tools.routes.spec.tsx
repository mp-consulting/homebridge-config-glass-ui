import type { RouteObject } from 'react-router'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startupScriptLoader } from '@/modules/platform-tools/docker/startup-script/startup-script.loader'
import * as platformTools from '@/modules/platform-tools/route'
import { fakeApi, toastStub } from '@/testing'

const holder = vi.hoisted(() => ({ toast: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return holder.toast
  },
}))

/**
 * The platform tools route table: the docker and linux pages, and the terminal.
 *
 * Every page is lazily loaded from its `route.tsx`. TypeScript checks the import
 * paths, so what is left to check here is that each lazy module really does
 * export a `Component` (a renamed export is a blank page at runtime) and that
 * the paths are the ones the menu links to.
 *
 * The Angular table also carried the terminal's `canDeactivate`; here the page
 * owns it (`useTerminalNavigationGuard`, covered in terminal-pages.spec).
 */
describe('the platform tools routes', () => {
  const { children } = platformTools

  /**
   * Every route in the table, children included.
   * @param routes - the routes to walk
   */
  function flatten(routes: RouteObject[]): RouteObject[] {
    return routes.flatMap(route => [route, ...flatten(route.children ?? [])])
  }

  /** One route by its path below /platform-tools, for the assertions that name one. */
  function routeFor(path: string): RouteObject {
    let routes = children
    let found: RouteObject | undefined
    for (const part of path.split('/')) {
      found = routes.find(route => route.path === part)
      expect(found, `no route for ${path}`).toBeDefined()
      routes = found!.children ?? []
    }
    return found!
  }

  /** Load a route's lazy module. */
  async function load(route: RouteObject): Promise<Record<string, unknown>> {
    return (route.lazy as () => Promise<Record<string, unknown>>)()
  }

  beforeEach(() => {
    holder.toast = toastStub()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders its children through an outlet', () => {
    // The section has no page of its own
    expect(platformTools.Component).toBeTypeOf('function')
  })

  describe('the pages it can load', () => {
    it.each([
      'docker/startup-script',
      'docker/restart-container',
      'linux/restart-server',
      'linux/shutdown-server',
      'terminal',
    ])('has a route for %s', (path) => {
      expect(routeFor(path).lazy).toBeTypeOf('function')
    })

    it.each(
      flatten(children)
        .filter(route => route.lazy)
        .map(route => [route.path, route] as const),
    )('can actually load %s', async (_path, route) => {
      // A renamed export resolves to undefined here and to a blank page in the app
      const mod = await load(route)

      expect(mod.Component).toBeTypeOf('function')
    })
  })

  describe('where an empty path goes', () => {
    it.each(['', 'docker', 'linux'])('sends %s back to the dashboard', async (path) => {
      // These sections have no landing page of their own
      const route = path === '' ? children[0] : routeFor(path).children![0]

      expect(route.index).toBe(true)
      const response = await (route.loader as () => Promise<Response> | Response)()
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/')
    })
  })

  describe('loading the startup script before the page opens', () => {
    it('resolves it through the startup script loader', async () => {
      // The editor needs the script in hand; fetching it on mount would show an
      // empty editor first
      const api = fakeApi().respond('get', '/platform-tools/docker/startup-script', { script: '#!/bin/sh' })
      const mod = await load(routeFor('docker/startup-script'))

      await expect((mod.loader as () => Promise<unknown>)()).resolves.toEqual({ script: '#!/bin/sh' })
      expect(api.callsTo('get', '/platform-tools/docker/startup-script')).toHaveLength(1)
    })

    it('goes home with an error when the script cannot be read', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      fakeApi().fail('get', '/platform-tools/docker/startup-script', { status: 500, error: { message: 'no container' } })

      const response = await startupScriptLoader() as Response

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/')
      expect(holder.toast!.at('error')).toHaveLength(1)
    })
  })
})
