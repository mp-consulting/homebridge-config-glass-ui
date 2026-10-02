import type { Guard } from '@/core/auth'
import type { ComponentType } from 'react'
import type { LoaderFunction, LoaderFunctionArgs, PatchRoutesOnNavigationFunction, RouteObject, ShouldRevalidateFunction } from 'react-router'

import { createBrowserRouter, redirect } from 'react-router'

import { Root } from '@/app/Root'
import { RouteError } from '@/app/RouteError'
import { basePath, logsGuard, requireAdmin, requireAuth, requireLoggedOut, setupWizardGuard } from '@/core/auth'

/** What a `src/modules/<dir>/route.tsx` exports: the page `Component`, and optionally a `loader`, `shouldRevalidate` or `children`. */
export interface RouteModule {
  Component?: ComponentType
  ErrorBoundary?: ComponentType
  /** The Angular route's resolver, run after the guard. */
  loader?: LoaderFunction
  /** Child routes (platform-tools), relative to the module's path. */
  children?: RouteObject[]
  shouldRevalidate?: ShouldRevalidateFunction
  handle?: unknown
}

type LoadModule = () => Promise<RouteModule>

/**
 * A lazily loaded page behind an optional guard.
 *
 * A route has one loader, so the guard and the page's own resolver are chained
 * in it: the guard first (as Angular ran `canActivate` before `resolve`), and
 * the resolver only once the guard has let the navigation through. The lazy
 * part brings the rest of the module, minus its loader, which react-router
 * would otherwise ignore with a warning next to this one.
 * @param importModule - the module's dynamic import
 * @param guard - the guard loader, if the route has one
 */
function page(importModule: LoadModule, guard?: Guard): Pick<RouteObject, 'loader' | 'lazy'> {
  // The loader and lazy run side by side; both wait on one import. A failed
  // import is not kept, so the next navigation tries again.
  let pending: Promise<RouteModule> | undefined
  const load = () => {
    pending ??= importModule().catch((error) => {
      pending = undefined
      throw error
    })
    return pending
  }
  return {
    loader: async (args: LoaderFunctionArgs) => {
      if (guard) {
        const blocked = await guard(args)
        if (blocked) {
          return blocked
        }
      }
      const mod = await load()
      return mod.loader ? mod.loader(args) : null
    },
    lazy: async () => {
      // Everything else the module exports (Component, ErrorBoundary,
      // shouldRevalidate, handle) is route properties as they are
      const mod = await load()
      return Object.fromEntries(Object.entries(mod).filter(([key]) => key !== 'loader' && key !== 'children'))
    },
  }
}

const loadPlatformTools: LoadModule = () => import('@/modules/platform-tools/route')

/** The route ids the platform-tools children are patched under. */
export const PLATFORM_TOOLS_ROUTE_ID = 'platform-tools'

export const routes: RouteObject[] = [
  {
    id: 'root',
    Component: Root,
    ErrorBoundary: RouteError,
    HydrateFallback: () => null,
    children: [
      {
        path: 'login',
        ...page(() => import('@/modules/login/route'), requireLoggedOut),
      },
      {
        path: 'setup',
        ...page(() => import('@/modules/setup-wizard/route'), setupWizardGuard),
      },
      {
        // Everything behind sign-in, loaded lazily so the libraries only these
        // pages use stay out of the bundle /login downloads
        id: 'layout',
        path: '',
        loader: requireAuth,
        lazy: async () => ({ Component: (await import('@/shared/layout/Layout')).Layout }),
        children: [
          {
            index: true,
            ...page(() => import('@/modules/status/route')),
          },
          {
            path: 'restart',
            ...page(() => import('@/modules/restart/route'), requireAdmin),
          },
          {
            path: 'plugins',
            ...page(() => import('@/modules/plugins/route'), requireAuth),
          },
          {
            path: 'config',
            ...page(() => import('@/modules/config-editor/route'), requireAdmin),
          },
          {
            path: 'accessories',
            ...page(() => import('@/modules/accessories/route'), requireAuth),
          },
          {
            path: 'logs',
            ...page(() => import('@/modules/logs/route'), logsGuard),
          },
          {
            path: 'users',
            ...page(() => import('@/modules/users/route'), requireAdmin),
          },
          {
            path: 'settings',
            ...page(() => import('@/modules/settings/route'), requireAdmin),
          },
          {
            path: 'support',
            ...page(() => import('@/modules/support/route'), requireAuth),
          },
          {
            path: 'power-options',
            ...page(() => import('@/modules/power-options/route'), requireAdmin),
          },
          {
            // Its child routes live in the module and are patched in on the
            // first navigation below /platform-tools (see patchRoutesOnNavigation)
            id: PLATFORM_TOOLS_ROUTE_ID,
            path: 'platform-tools',
            ...page(loadPlatformTools, requireAdmin),
          },
        ],
      },
      {
        // Unknown urls go home
        path: '*',
        loader: () => redirect('/'),
      },
    ],
  },
]

let platformToolsPatched = false

/**
 * Lazy route discovery for the one module that owns child routes. Called for a
 * path that does not match, or only matches the catch-all.
 */
export const patchRoutesOnNavigation: PatchRoutesOnNavigationFunction = async ({ path, patch }) => {
  if (platformToolsPatched || !/^\/platform-tools(?:[/?#]|$)/.test(path)) {
    return
  }
  const { children } = await loadPlatformTools()
  if (children?.length && !platformToolsPatched) {
    platformToolsPatched = true
    patch(PLATFORM_TOOLS_ROUTE_ID, children)
  }
}

/** For specs: forget that the platform-tools children were patched in. */
export function resetRoutePatches(): void {
  platformToolsPatched = false
}

/**
 * The app's router. Its basename is the path of `<base href>`, so the UI works
 * behind a reverse proxy subpath like the Angular build did (APP_BASE_HREF
 * follows `<base href>` there).
 */
export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(routes, {
    basename: basePath() || '/',
    patchRoutesOnNavigation,
  })
}

let appRouter: ReturnType<typeof createBrowserRouter> | undefined

/** The one router of the page, created on first use. */
export function getAppRouter(): ReturnType<typeof createBrowserRouter> {
  appRouter ??= createAppRouter()
  return appRouter
}
