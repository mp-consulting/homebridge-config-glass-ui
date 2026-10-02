import { PluginsPage } from './PluginsPage'

/** `/plugins` (guard: `requireAuth`, owned by the router). The page owns its canDeactivate. */
export function Component() {
  return <PluginsPage />
}
