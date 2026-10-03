import type { RenderOptions, RenderResult } from '@testing-library/react'
import type { i18n as I18n } from 'i18next'
import type { ReactElement, ReactNode } from 'react'
import type { InitialEntry, RouteObject } from 'react-router'

import { render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createMemoryRouter, RouterProvider } from 'react-router'

/**
 * The app's i18n instance, if `@/core/ui/i18n` exists yet. Looked up through
 * a glob so this harness keeps working while that module is still being
 * written (a missing static import would fail every spec that renders).
 */
const i18nModules = import.meta.glob<{ i18n?: I18n, default?: I18n }>(
  ['../core/ui/i18n.ts', '../core/ui/i18n.tsx', '../core/ui/i18n/index.ts', '../core/ui/i18n/index.tsx'],
  { eager: true },
)

function appI18n(): I18n | undefined {
  for (const mod of Object.values(i18nModules)) {
    const instance = mod.i18n ?? mod.default
    if (instance) {
      return instance
    }
  }
  return undefined
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /**
   * The route path `ui` is mounted at, with params if it reads any
   * (e.g. `/plugins/:pluginName`). Defaults to `/`.
   */
  route?: string
  /** The history to start from (paths, or locations with router state). Defaults to `[route]` (params left as written). */
  initialEntries?: InitialEntry[]
  /** Extra routes next to the one under test, e.g. a redirect target. */
  routes?: RouteObject[]
  /** Replace the app's i18n instance, e.g. one with test resources. */
  i18n?: I18n
}

export interface RenderWithProvidersResult extends RenderResult {
  /** The memory router; drive navigation with `router.navigate('/elsewhere')`. */
  router: ReturnType<typeof createMemoryRouter>
}

/**
 * Render `ui` the way the app does: inside a data router (so `useBlocker`,
 * `useNavigate`, loaders… work) and the i18n provider.
 *
 * Any path that is not `route` (or one of `routes`) renders
 * `<div data-testid="other-route">`, so a spec can tell that the component
 * navigated away.
 */
export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}): RenderWithProvidersResult {
  const { route = '/', initialEntries, routes = [], i18n, ...renderOptions } = options

  const router = createMemoryRouter(
    [
      { path: route, element: ui },
      ...routes,
      { path: '*', element: <div data-testid="other-route" /> },
    ],
    { initialEntries: initialEntries ?? [route] },
  )

  const instance = i18n ?? appI18n()
  const tree: ReactNode = <RouterProvider router={router} />

  const result = render(instance ? <I18nextProvider i18n={instance}>{tree}</I18nextProvider> : tree, renderOptions)
  return { ...result, router }
}
