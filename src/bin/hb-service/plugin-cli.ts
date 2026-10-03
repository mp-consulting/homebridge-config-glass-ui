import type { Logger } from '../logger.js'

import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import process from 'node:process'

import { pathExists } from 'fs-extra/esm'

import { RE_NON_SCOPED, RE_PLUGIN_NAME, RE_SCOPED } from '../../core/regex.constants.js'

export interface NpmPackageSpec {
  name: string
  version: string
  path: string
}

/**
 * Parse an npm package and version string, e.g. `@scope/name@1.2.3`
 * (the version defaults to `latest`). Null when the string is not a package.
 * Based on: https://github.com/egoist/parse-package-name
 */
export function parseNpmPackageString(input: string): NpmPackageSpec | null {
  const m = RE_SCOPED.exec(input) || RE_NON_SCOPED.exec(input)

  if (!m) {
    return null
  }

  return {
    name: m[1] || '',
    version: m[2] || 'latest',
    path: m[3] || '',
  }
}

// target.name is regex-validated; target.version isn't by the parser, which
// captures anything up to the next slash, so a string like "1.0.0; rm -rf /"
// would otherwise reach the spawn unchecked. Limit it to semver-shaped strings
// and dist tags (alphanumerics, dots, dashes, semver operators).
const RE_NPM_VERSION_OR_TAG = /^[\w.\-^~>=<*|+]+$/

/**
 * The plugin to add or remove from `hb-service add|remove <plugin>[@<version>]`,
 * or the error to show when the argument is not a valid plugin.
 */
export function parsePluginTarget(input: string): { target: NpmPackageSpec } | { error: string } {
  const target = parseNpmPackageString(input)

  if (!target?.name || !RE_PLUGIN_NAME.test(target.name)) {
    return { error: 'Invalid plugin name.' }
  }

  if (!RE_NPM_VERSION_OR_TAG.test(target.version)) {
    return { error: `Invalid plugin version "${target.version}".` }
  }

  return { target }
}

/**
 * The npm arguments that add or remove `target` in the `cwd` prefix
 */
export function pluginNpmArgs(action: 'add' | 'remove', target: NpmPackageSpec, cwd: string): string[] {
  return ['--prefix', cwd, action, action === 'add' ? `${target.name}@${target.version}` : target.name]
}

/**
 * Install / Remove a plugin (supported platforms only)
 */
export async function npmPluginManagement(args: any[], { enabled, logger }: { enabled: boolean, logger: Logger }) {
  if (!enabled) {
    logger.error('Plugin management is not supported on your platform using hb-service.')
    process.exit(1)
  }

  if (args.length === 1) {
    logger.error('Plugin name required.')
    process.exit(1)
  }

  const action: 'add' | 'remove' = args[0]
  const parsed = parsePluginTarget(args.at(-1))

  if ('error' in parsed) {
    logger.error(parsed.error)
    process.exit(1)
  }
  const { target } = parsed

  const cwd = dirname(process.env.UIX_CUSTOM_PLUGIN_PATH)

  if (!await pathExists(cwd)) {
    logger.error(`Path does not exist: ${cwd}.`)
  }

  const npmArgs = pluginNpmArgs(action, target, cwd)

  logger.log(`CMD: npm ${npmArgs.join(' ')}`)

  try {
    // execFileSync (argv form, no shell) keeps target.name and
    // target.version out of any shell parser even if the validation
    // regexes ever loosen.
    execFileSync('npm', npmArgs, {
      cwd,
      stdio: 'inherit',
    })
    logger.success(`Installed ${target.name}@${target.version}.`)
  } catch (e) {
    logger.error(`Plugin installation failed as ${e.message}.`)
  }
}
