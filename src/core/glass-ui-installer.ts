/* global NodeJS */
/**
 * Switches a Homebridge install from the official web interface
 * (homebridge-config-ui-x) to Homebridge Glass UI, and back.
 *
 * The packaged installs (the Synology DSM package, the Debian/Raspberry Pi
 * package and the Docker image built on it) keep the UI in their own npm
 * prefix and start it from a hard-coded path: `UIX_BASE_PATH_OVERRIDE` and
 * `HB_SERVICE_EXEC_PATH` point into `<prefix>/lib/node_modules/homebridge-config-ui-x`.
 * Replacing the package alone leaves that path empty and the package no longer
 * starts Homebridge at all, so the old folder name becomes a link to Glass UI.
 * A plain `npm install -g` also fails while the old UI owns the `hb-service`
 * command, so the old UI is uninstalled first - and put back if Glass UI then
 * fails to install.
 */

import { lstat, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

export const GLASS_UI_PACKAGE = '@mp-consulting/homebridge-config-glass-ui'
export const OFFICIAL_UI_PACKAGE = 'homebridge-config-ui-x'

// npm 12 skips dependency install scripts unless allowed; the terminal's
// native module needs its install script
export const ALLOW_SCRIPTS = '--allow-scripts=@homebridge/node-pty-prebuilt-multiarch'

// Where the packaged installs keep their npm prefix
const PACKAGE_ROOTS = [
  { root: '/var/packages/homebridge/target/app', name: 'Synology DSM package' },
  { root: '/opt/homebridge', name: 'Homebridge package' },
]

// Remembers which version of the official UI was replaced, for revert
const MARKER_FILE = '.glass-ui-replaced.json'

/** Runs `npm` with these arguments, passing its output through. Resolves to its exit code. */
export type NpmRunner = (args: string[]) => Promise<number>

export interface InstallerOptions {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  npm: NpmRunner
  log: (message: string) => void
  /** The global npm prefix, when the environment does not set npm_config_prefix */
  globalPrefix: () => Promise<string>
  /** Whether a path exists; overridable so tests need not create the package roots */
  exists: (path: string) => Promise<boolean>
}

export interface InstallTarget {
  prefix: string
  globalModules: string
  /** The packaged install's hard-coded UI folder, or undefined for a plain npm install */
  legacyPath?: string
  environment: string
}

export class InstallerError extends Error {}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

async function readPackageJson(dir: string): Promise<{ name?: string, version?: string } | null> {
  try {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Work out which npm prefix to install into, and whether it is a packaged install. */
export async function resolveTarget(options: InstallerOptions): Promise<InstallTarget> {
  const { env } = options
  const override = env.UIX_BASE_PATH_OVERRIDE

  // Inside a packaged install's shell, its source.sh says where the UI lives
  if (override && basename(override) === OFFICIAL_UI_PACKAGE) {
    const globalModules = dirname(override)
    const prefix = env.npm_config_prefix || dirname(dirname(globalModules))
    const known = PACKAGE_ROOTS.find(x => prefix === x.root)
    const environment = env.HOMEBRIDGE_SYNOLOGY_PACKAGE === '1'
      ? 'Synology DSM package'
      : env.HOMEBRIDGE_CONFIG_UI === '1' ? 'Docker image' : known?.name ?? 'Homebridge package'
    return { prefix, globalModules, legacyPath: override, environment }
  }

  // A packaged install reached from an ordinary shell: npm would install into
  // the wrong place, and the package would not see it
  for (const { root, name } of PACKAGE_ROOTS) {
    if (await options.exists(join(root, 'lib', 'node_modules')) && env.npm_config_prefix !== root) {
      throw new InstallerError(
        `This looks like the ${name} (${root}), but this shell is not the Homebridge one, so npm would install in the wrong place. `
        + 'Run the command again from the Homebridge shell: `hb-shell` (as root, `sudo hb-shell`), '
        + 'the terminal in the Homebridge web interface, or `docker exec -it <container> hb-shell`.',
      )
    }
  }

  const prefix = env.npm_config_prefix || await options.globalPrefix()
  const globalModules = options.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
  return { prefix, globalModules, environment: 'npm global install' }
}

function restartHint(target: InstallTarget): string {
  switch (target.environment) {
    case 'Synology DSM package':
      return 'Restart Homebridge from Package Center (or `sudo synopkg restart homebridge`).'
    case 'Docker image':
      return 'Restart the container.'
    case 'npm global install':
      return 'Restart Homebridge: `sudo hb-service restart` if it runs as a service, otherwise restart it the way you started it.'
    default:
      return 'Restart Homebridge: `sudo hb-service restart`.'
  }
}

function markerPath(target: InstallTarget) {
  return join(dirname(target.globalModules), MARKER_FILE)
}

/**
 * The old UI's `hb-service` link, when it points into a package that is no
 * longer there. npm will not replace a command owned by another package.
 */
async function removeStaleBin(target: InstallTarget, log: InstallerOptions['log']) {
  if (!target.legacyPath) {
    return
  }
  const bin = join(target.prefix, 'bin', 'hb-service')
  if (!(await lstatOrNull(bin))?.isSymbolicLink()) {
    return
  }
  const linkTarget = await readlink(bin)
  if (linkTarget.includes(`node_modules/${OFFICIAL_UI_PACKAGE}/`) && !(await lstatOrNull(target.legacyPath))) {
    log(`Removing the old ${bin} link.`)
    await rm(bin)
  }
}

async function ensureLegacyLink(target: InstallTarget, log: InstallerOptions['log']) {
  if (!target.legacyPath) {
    return
  }
  const existing = await lstatOrNull(target.legacyPath)
  const linkTarget = relative(dirname(target.legacyPath), join(target.globalModules, GLASS_UI_PACKAGE))
  if (existing?.isSymbolicLink()) {
    if (await readlink(target.legacyPath) === linkTarget) {
      return
    }
    await rm(target.legacyPath)
  } else if (existing) {
    throw new InstallerError(`${target.legacyPath} still exists; remove it and run this again.`)
  }
  log(`Linking ${target.legacyPath} -> ${linkTarget}, where the package starts the UI from.`)
  await symlink(linkTarget, target.legacyPath, 'dir')
}

async function npmOrThrow(options: InstallerOptions, args: string[], what: string) {
  const code = await options.npm(args)
  if (code !== 0) {
    throw new InstallerError(`${what} failed (npm exited with ${code}).`)
  }
}

/** Replace the official UI with Glass UI at `version`, or update Glass UI in place. */
export async function installGlassUi(options: InstallerOptions, version: string): Promise<InstallTarget> {
  const { log } = options
  const target = await resolveTarget(options)
  log(`Installing ${GLASS_UI_PACKAGE}@${version} (${target.environment}, ${target.prefix}).`)

  // The official UI, installed as a real package (not our link)
  const officialPath = target.legacyPath ?? join(target.globalModules, OFFICIAL_UI_PACKAGE)
  const officialStat = await lstatOrNull(officialPath)
  const official = officialStat && !officialStat.isSymbolicLink() ? await readPackageJson(officialPath) : null
  const replacing = official?.name === OFFICIAL_UI_PACKAGE

  if (replacing) {
    log(`Replacing ${OFFICIAL_UI_PACKAGE}@${official.version}. It can be put back with \`npx ${GLASS_UI_PACKAGE} revert\`.`)
    await writeFile(markerPath(target), JSON.stringify({ version: official.version }))
    await npmOrThrow(options, ['uninstall', '-g', OFFICIAL_UI_PACKAGE], `Removing ${OFFICIAL_UI_PACKAGE}`)
  }

  try {
    await removeStaleBin(target, log)
    await npmOrThrow(options, ['install', '-g', ALLOW_SCRIPTS, `${GLASS_UI_PACKAGE}@${version}`], `Installing ${GLASS_UI_PACKAGE}`)
    await ensureLegacyLink(target, log)
  } catch (error) {
    if (replacing) {
      // Leave the instance with a web interface rather than none
      log(`Putting ${OFFICIAL_UI_PACKAGE}@${official.version} back.`)
      await options.npm(['uninstall', '-g', GLASS_UI_PACKAGE])
      await options.npm(['install', '-g', ALLOW_SCRIPTS, `${OFFICIAL_UI_PACKAGE}@${official.version}`])
      await rm(markerPath(target), { force: true })
    }
    throw error
  }

  log(`Homebridge Glass UI ${version} is installed. ${restartHint(target)}`)
  if (target.legacyPath) {
    log('An update of the Homebridge package (or a new container) brings the official interface back; run this command again afterwards.')
  }
  return target
}

/** Put the official UI back: the version Glass UI replaced, or the latest. */
export async function revertToOfficialUi(options: InstallerOptions): Promise<InstallTarget> {
  const { log } = options
  const target = await resolveTarget(options)
  let version = 'latest'
  try {
    version = JSON.parse(await readFile(markerPath(target), 'utf8')).version || 'latest'
  } catch {
    // No readable marker (Glass UI was installed by hand, or the marker was
    // removed): the version it replaced is unknown, so reinstall the latest
  }

  if (target.legacyPath && (await lstatOrNull(target.legacyPath))?.isSymbolicLink()) {
    await rm(target.legacyPath)
  }
  await npmOrThrow(options, ['uninstall', '-g', GLASS_UI_PACKAGE], `Removing ${GLASS_UI_PACKAGE}`)
  await npmOrThrow(options, ['install', '-g', ALLOW_SCRIPTS, `${OFFICIAL_UI_PACKAGE}@${version}`], `Installing ${OFFICIAL_UI_PACKAGE}`)
  await rm(markerPath(target), { force: true })

  log(`${OFFICIAL_UI_PACKAGE}@${version} is back. ${restartHint(target)}`)
  return target
}
