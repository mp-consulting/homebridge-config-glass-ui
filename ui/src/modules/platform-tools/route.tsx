import type { RouteObject } from 'react-router'

import { Outlet, redirect } from 'react-router'

/**
 * `/platform-tools/*` (guard: `requireAdmin`, owned by the router). The section
 * has no page of its own; its pages are the child routes below, patched in by
 * the app router on the first navigation under `/platform-tools`.
 */
export function Component() {
  return <Outlet />
}

/** These sections have no landing page of their own: an empty path goes home. */
const toDashboard = () => redirect('/')

/** The Angular `PLATFORM_TOOLS_ROUTES`, relative to `/platform-tools`. */

export const children: RouteObject[] = [
  {
    index: true,
    loader: toDashboard,
  },
  {
    path: 'docker',
    children: [
      {
        index: true,
        loader: toDashboard,
      },
      {
        path: 'startup-script',
        // The route module brings the component and the resolver (as `loader`)
        lazy: () => import('@/modules/platform-tools/docker/startup-script/route'),
      },
      {
        path: 'restart-container',
        lazy: () => import('@/modules/platform-tools/docker/container-restart/route'),
      },
    ],
  },
  {
    path: 'linux',
    children: [
      {
        index: true,
        loader: toDashboard,
      },
      {
        path: 'restart-server',
        lazy: () => import('@/modules/platform-tools/linux/restart-linux/route'),
      },
      {
        path: 'shutdown-server',
        lazy: () => import('@/modules/platform-tools/linux/shutdown-linux/route'),
      },
    ],
  },
  {
    // The page decides for itself whether it can be left (useTerminalNavigationGuard)
    path: 'terminal',
    lazy: () => import('@/modules/platform-tools/terminal/route'),
  },
]
