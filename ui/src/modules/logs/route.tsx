import { Logs } from './Logs'

/** `/logs` (guard: `logsGuard`, owned by the router). The page owns its canDeactivate. */
export function Component() {
  return <Logs />
}
