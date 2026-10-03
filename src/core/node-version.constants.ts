import process from 'node:process'

/**
 * Node.js version and architecture compatibility constants
 */

/**
 * The oldest Node.js release this package supports (the floor of `engines.node`
 * in package.json). hb-service refuses to install anything older.
 */
export const MIN_NODE_VERSION = '22.12.0'

/**
 * Architectures that support Node.js v24
 * Node.js v24 requires 64-bit architectures
 */
export const NODE_V24_SUPPORTED_ARCHITECTURES = ['x64', 'arm64', 'ppc64', 's390x'] as const

/**
 * Check if the current architecture supports Node.js v24
 */
export function isNodeV24SupportedArchitecture(arch: string = process.arch): boolean {
  return NODE_V24_SUPPORTED_ARCHITECTURES.includes(arch as any)
}
