import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'

/**
 * The node_modules directory the UI is installed in.
 *
 * The package is scoped, so it lives one level deeper than an unscoped package:
 * node_modules/@mp-consulting/homebridge-config-glass-ui. The parent of the package
 * directory is the scope directory, not node_modules, so anything looking for
 * sibling packages (such as homebridge itself) or comparing install locations
 * must go up past the scope.
 */
export function getUiNodeModulesPath(basePath: string = process.env.UIX_BASE_PATH): string {
  const parent = dirname(resolve(basePath))
  return basename(parent).startsWith('@') ? dirname(parent) : parent
}
