import { Settings } from './Settings'

/** `/settings` (guard: `requireAdmin`, owned by the router). */
export function Component() {
  return <Settings />
}
