import { Outlet, ScrollRestoration } from 'react-router'

import { ModalHost } from '@/core/ui/ModalHost'
import { ToastContainer } from '@/core/ui/ToastContainer'

/**
 * The root route: the routed page plus the toast and modal hosts, mounted
 * inside the router so a toast or modal can use the router hooks.
 * ScrollRestoration replaces Angular's `scrollPositionRestoration: 'enabled'`.
 */
export function Root() {
  return (
    <>
      <Outlet />
      <ToastContainer />
      <ModalHost />
      <ScrollRestoration />
    </>
  )
}
