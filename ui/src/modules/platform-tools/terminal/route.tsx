import { Terminal } from './Terminal'

/** `/platform-tools/terminal`. The page owns its canDeactivate (useTerminalNavigationGuard). */
export function Component() {
  return <Terminal />
}
