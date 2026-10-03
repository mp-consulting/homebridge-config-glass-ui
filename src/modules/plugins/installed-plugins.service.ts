/* global NodeJS */

import type { HomebridgeConfig } from '../../core/config/config.interfaces.js'
import type {
  HomebridgePlugin,
  IPackageJson,
} from './plugins.interfaces.js'

import { exec, execFile } from 'node:child_process'
import { readdir, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { cpus, platform } from 'node:os'
import {
  delimiter,
  dirname,
  join,
  resolve,
  sep,
} from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { Inject, Injectable } from '@nestjs/common'
import { pathExists, pathExistsSync, readJson } from 'fs-extra/esm'
import NodeCache from 'node-cache'
import pLimit from 'p-limit'
import { gt, lt, rcompare } from 'semver'

import { ConfigService } from '../../core/config/config.service.js'
import { getUiNodeModulesPath } from '../../core/install-paths.js'
import { Logger } from '../../core/logger/logger.service.js'
import {
  RE_URL,
} from '../../core/regex.constants.js'
import { PluginRegistryService } from './plugin-registry.service.js'

// Create a require function for ESM compatibility
const require = createRequire(import.meta.url)
const module = require('node:module')

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

// How long a filesystem scan of the installed modules is reused - the same
// lifetime as the installed plugins cache built from it
const INSTALLED_MODULES_TTL_MS = 60_000

interface InstalledModule { name: string, path: string, installPath: string }

/**
 * What is installed on disk: the plugin search paths, the installed-modules
 * scan and the caches built from it, plus the Homebridge, UI and npm packages.
 */
@Injectable()
export class InstalledPluginsService {
  /** How many registry requests the installed-plugins scan runs at once. */
  static readonly REGISTRY_CONCURRENCY = 12

  private npmGlobalRootPromise: Promise<string | null> | null = null
  private _paths: Array<string> | undefined
  private pathsPromise: Promise<Array<string>> | null = null
  private warnedDuplicateUiInstall = false

  // Installed plugin cache
  private installedPlugins: HomebridgePlugin[]

  // NPM package cache
  private npmPackage: HomebridgePlugin

  // Cache for installed plugins to avoid redundant file system operations
  // Cached by reference: callers only read the list (or copy an entry before
  // changing it), and cloning every plugin's metadata on each read is costly
  private installedPluginsCache = new NodeCache({ stdTTL: 60, useClones: false })

  // The in-flight or settled installed-modules scan. getHomebridgePackage,
  // getHomebridgeUiPackage and getInstalledPlugins each need it, so a single
  // dashboard load used to walk every node_modules folder up to three times.
  // Kept as a promise (not in NodeCache, which clones what it returns) so
  // concurrent callers share one scan.
  private installedModulesCache: { promise: Promise<InstalledModule[]>, expires: number } | null = null

  // Set while runNpmCommand is mid-flight so concurrent reads (notably
  // /auth/settings) can skip the synchronous filesystem walk that would
  // otherwise re-cache a mid-install snapshot.
  private pluginManagementInProgress = 0
  public get isPluginManagementInProgress(): boolean {
    return this.pluginManagementInProgress > 0
  }

  /**
   * Called by the installer around each npm run. Finishing invalidates the
   * caches only after npm exits, not before — invalidating up front would let
   * concurrent /plugins or /auth/settings calls walk the filesystem
   * mid-install and re-cache a half-installed snapshot for 60s.
   */
  public pluginManagementStarted(): void {
    this.pluginManagementInProgress += 1
  }

  public pluginManagementFinished(): void {
    this.installedPluginsCache.del('installed-plugins')
    this.installedModulesCache = null
    this.pluginManagementInProgress -= 1
  }

  /**
   * The installed plugins as last loaded by getInstalledPlugins, without
   * loading them; undefined until the first load
   */
  public get loadedPlugins(): HomebridgePlugin[] | undefined {
    return this.installedPlugins
  }

  constructor(
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PluginRegistryService) private readonly registry: PluginRegistryService,
  ) {}

  /**
   * Lazy base paths - computed only when first needed, then reused.
   * Concurrent first callers share one computation (it queries npm).
   */
  private async getPaths(): Promise<Array<string>> {
    if (this._paths) {
      return this._paths
    }
    this.pathsPromise ??= this.getBasePaths()
      .then((paths) => {
        this._paths = paths
        return paths
      })
      .finally(() => {
        this.pathsPromise = null
      })
    return this.pathsPromise
  }

  /**
   * Return the installed-plugins list only if it is already cached, without
   * triggering the filesystem walk on a miss. Hot-path callers on the
   * bootstrap/login critical path (e.g. `GET /auth/settings`) use this so a
   * cold cache never blocks the response on a full scan.
   */
  public getCachedInstalledPlugins(): HomebridgePlugin[] | undefined {
    return this.installedPluginsCache.get<HomebridgePlugin[]>('installed-plugins')
  }

  /**
   * Return an array of plugins currently installed
   */
  public async getInstalledPlugins(): Promise<HomebridgePlugin[]> {
    // Check cache first
    const cached = this.installedPluginsCache.get<HomebridgePlugin[]>('installed-plugins')
    if (cached) {
      this.installedPlugins = cached
      return cached
    }

    const plugins: HomebridgePlugin[] = []
    const modules = await this.getInstalledModules()
    const disabledPlugins = await this.getDisabledPlugins()

    // Filter out non-homebridge plugins by name
    const homebridgePlugins = modules.filter(module =>
      ((module.name.indexOf('homebridge-') === 0) || this.registry.isScopedPlugin(module.name))
      && pathExistsSync(join(module.installPath, 'package.json')),
    )

    // The package.json reads are local disk work, so they are limited to the
    // number of cpu cores. The parse is mostly a registry request per plugin,
    // which waits on the network rather than the cpu, so more run at once.
    const fileLimit = pLimit(Math.max(2, cpus().length))
    const networkLimit = pLimit(InstalledPluginsService.REGISTRY_CONCURRENCY)

    await Promise.all(homebridgePlugins.map(async (pkg) => {
      try {
        const pkgJson: IPackageJson = await fileLimit(() => readJson(join(pkg.installPath, 'package.json')))
        // Check each plugin has the 'homebridge-plugin' keyword
        if (pkgJson.keywords && pkgJson.keywords.includes('homebridge-plugin')) {
          // Parse the package.json for each plugin
          const plugin = await networkLimit(() => this.registry.parsePackageJson(pkgJson, pkg.path))

          // Check if the plugin has been disabled
          plugin.disabled = disabledPlugins.includes(plugin.name)

          // Filter out duplicate plugins and give preference to non-global plugins.
          // The UI is deduplicated here too because it carries the 'homebridge-plugin'
          // keyword, but 'prefer non-global' is wrong for it: it runs from
          // UIX_BASE_PATH, which is normally the global install. Letting a shadow copy
          // under customPluginPath win made manageUi() update that copy instead of the
          // one running, so the same update was offered again after every restart.
          const existingPlugin = plugins.find(x => plugin.name === x.name)
          const isUi = plugin.name === this.configService.name
          const isRunningUi = isUi && resolve(plugin.installPath) === getUiNodeModulesPath()
          if (!existingPlugin) {
            plugins.push(plugin)
          } else if (isUi ? isRunningUi : (!plugin.globalInstall && existingPlugin.globalInstall === true)) {
            const index = plugins.indexOf(existingPlugin)
            plugins[index] = plugin
          }
        }
      } catch (e) {
        this.logger.error(`Failed to parse plugin ${pkg.name} as ${e.message}.`)
      }
    }))

    this.installedPlugins = plugins.map(plugin => this.registry.fixDisplayName(plugin))

    // Cache the result
    this.installedPluginsCache.set('installed-plugins', this.installedPlugins)

    return this.installedPlugins
  }

  /**
   * Returns an array of out-of-date plugins
   */
  public async getOutOfDatePlugins(): Promise<HomebridgePlugin[]> {
    const plugins = await this.getInstalledPlugins()
    return plugins.filter(x => x.updateAvailable)
  }

  /**
   * Gets the Homebridge package details
   */
  public async getHomebridgePackage() {
    // Try a load from the "homebridgePackagePath" option first
    if (this.configService.ui.homebridgePackagePath) {
      const pkgJsonPath = join(this.configService.ui.homebridgePackagePath, 'package.json')
      if (await pathExists(pkgJsonPath)) {
        return await this.registry.parsePackageJson(await readJson(pkgJsonPath), this.configService.ui.homebridgePackagePath)
      } else {
        this.logger.error(`The Homebridge path ${this.configService.ui.homebridgePackagePath} does not exist.`)
      }
    }

    const modules = await this.getInstalledModules()

    const homebridgeInstalls = modules.filter(x => x.name === 'homebridge')

    if (homebridgeInstalls.length > 1) {
      this.logger.warn('Multiple instances of Homebridge were found, see https://homebridge.io/w/JJSgm for help.')
      homebridgeInstalls.forEach((instance) => {
        this.logger.warn(instance.installPath)
      })
    }

    if (!homebridgeInstalls.length) {
      this.configService.hbServiceUiRestartRequired = true
      this.logger.error('Unable to find Homebridge installation, see https://homebridge.io/w/JJSgZ for help.')
      throw new Error('Unable To Find Homebridge Installation.')
    }

    let homebridgeModule = homebridgeInstalls[0]

    // Prefer the install hb-service reported it actually launched — otherwise the
    // UI reports (and updates) a copy that is not running, while the stale copy
    // keeps starting (#2897). Checked even when only one install was discovered,
    // because the running one can live outside the paths we scan.
    const runningModule = await this.findRunningHomebridgeInstall(homebridgeInstalls)
    if (runningModule) {
      homebridgeModule = runningModule
    }

    const pkgJson: IPackageJson = await readJson(join(homebridgeModule.installPath, 'package.json'))
    const homebridge = await this.registry.parsePackageJson(pkgJson, homebridgeModule.path)
    homebridge.multipleInstances = homebridgeInstalls.length > 1

    if (!homebridge.latestVersion) {
      return homebridge
    }

    // Apply update policy for Homebridge
    const updatePolicy = this.configService.ui.homebridgeUpdatePolicy || 'all'

    if (updatePolicy === 'none') {
      homebridge.updateAvailable = false
      homebridge.latestVersion = null
    } else if (updatePolicy === 'major') {
      // Find the latest version within the same major version
      const currentMajor = Number.parseInt(homebridge.installedVersion.split('.')[0], 10)
      const versions = await this.registry.getAvailablePluginVersions('homebridge')

      // Filter to versions in the same major and not deprecated
      const sameMajorVersions = Object.keys(versions.versions)
        .filter((version) => {
          const versionMajor = Number.parseInt(version.split('.')[0], 10)
          return versionMajor === currentMajor
        })
        .sort(rcompare) // Sort descending (highest first)

      if (sameMajorVersions.length > 0 && gt(sameMajorVersions[0], homebridge.installedVersion)) {
        // There's a newer version in the same major
        homebridge.latestVersion = sameMajorVersions[0]
        homebridge.updateAvailable = true
        homebridge.updateEngines = versions.versions[sameMajorVersions[0]]?.engines || null
      } else {
        // No newer version in same major
        homebridge.updateAvailable = false
      }
    } else if (updatePolicy === 'beta') {
      await this.registry.checkForBetaUpdates(homebridge, 'homebridge', true)
    }

    // Only let this on-disk version become the authoritative one when it really is
    // the running install. hb-service reports the running version over IPC, and
    // that value also drives the feature flags — so letting a discovered-but-not-
    // running copy overwrite it makes the UI show the wrong version and offer
    // features the running Homebridge does not have (#2897).
    if (!this.configService.runningHomebridgeModulePath || runningModule) {
      this.configService.homebridgeVersion = homebridge.installedVersion
    }

    return homebridge
  }

  /**
   * Out of several Homebridge installs, find the one whose module path matches
   * what hb-service reported it launched (sent over IPC at startup). Compared
   * via realpath since these installs are commonly reached through symlinks.
   * Returns null when not running under hb-service or when nothing matches.
   */
  private async findRunningHomebridgeInstall(installs: Array<{ name: string, path: string, installPath: string }>) {
    if (!this.configService.runningHomebridgeModulePath) {
      return null
    }

    try {
      const runningPath = await realpath(this.configService.runningHomebridgeModulePath)
      for (const install of installs) {
        try {
          if (await realpath(install.installPath) === runningPath) {
            return install
          }
        } catch (e) {
          this.logger.debug(`Failed to resolve Homebridge install path ${install.installPath} as ${e.message}.`)
        }
      }
    } catch (e) {
      this.logger.debug(`Failed to resolve running Homebridge module path as ${e.message}.`)
    }

    return null
  }

  /**
   * Whether the given install path is already among the modules of that name,
   * compared via realpath so a symlinked duplicate is not added twice
   */
  private async containsInstallPath(modules: Array<{ name: string, installPath: string }>, name: string, resolvedPath: string) {
    for (const module of modules.filter(x => x.name === name)) {
      try {
        if (await realpath(module.installPath) === resolvedPath) {
          return true
        }
      } catch (e) {
        this.logger.debug(`Failed to resolve ${name} install path ${module.installPath} as ${e.message}.`)
      }
    }

    return false
  }

  /**
   * Clear the installed plugins cache
   * Used when beta preferences change to force refresh
   */
  public clearInstalledPluginsCache() {
    this.installedPluginsCache.del('installed-plugins')
    this.installedModulesCache = null
  }

  /**
   * Gets the Homebridge Glass UI package details
   * Special-cased like getHomebridgePackage() to avoid double beta checking
   */
  public async getHomebridgeUiPackage(): Promise<HomebridgePlugin> {
    const modules = await this.getInstalledModules()
    const uiModules = modules.filter(x => x.name === this.configService.name)

    // Identify ourselves by where we are actually running from, rather than taking the
    // first name match. getBasePaths() searches customPluginPath first, so a second copy
    // of the UI sitting in the plugin directory shadowed the real installation and the UI
    // reported that copy's version as its own - which is how a beta user was told an
    // update was available to the very version they were already running.
    const runningPath = resolve(process.env.UIX_BASE_PATH)
    const uiModule = uiModules.find(x => resolve(x.installPath) === runningPath) ?? uiModules[0]

    if (!uiModule) {
      throw new Error('Unable to find Homebridge Glass UI installation.')
    }

    // A second copy is not harmless: npm reinstates it from the parent package.json on
    // every plugin update, so say so rather than quietly using the right one.
    if (uiModules.length > 1 && !this.warnedDuplicateUiInstall) {
      this.warnedDuplicateUiInstall = true
      this.logger.warn(`Found more than one installation of ${this.configService.name}: ${uiModules.map(x => x.installPath).join(', ')}. Using ${uiModule.installPath}, the one currently running. You should remove the others.`)
    }

    const pkgJson: IPackageJson = await readJson(join(uiModule.installPath, 'package.json'))

    // Build the plugin object manually (like parsePackageJson but inline to control the flow)
    const uiPackage: HomebridgePlugin = {
      name: pkgJson.name,
      displayName: pkgJson.displayName || this.registry.getListedName(pkgJson.name),
      private: pkgJson.private || false,
      description: (pkgJson.description)
        ? pkgJson.description.replace(RE_URL, '').trim()
        : pkgJson.name,
      verifiedPlugin: this.registry.isVerifiedPlugin(pkgJson.name),
      verifiedPlusPlugin: this.registry.isVerifiedPlusPlugin(pkgJson.name),
      supportsMatter: this.registry.supportsMatter(pkgJson.keywords),
      supportsHap: this.registry.supportsHap(pkgJson.keywords),
      icon: this.registry.getPluginIconUrl(pkgJson.name),
      isHbScoped: pkgJson.name.startsWith('@homebridge-plugins/'),
      newHbScope: this.registry.getNewScope(pkgJson.name),
      isUnmaintained: this.registry.isUnmaintainedPlugin(pkgJson.name),
      installedVersion: pkgJson.version || '0.0.1',
      globalInstall: (uiModule.path !== this.configService.customPluginPath),
      settingsSchema: await pathExists(resolve(uiModule.path, pkgJson.name, 'config.schema.json')),
      engines: pkgJson.engines,
      installPath: uiModule.path,
      funding: (this.registry.isVerifiedPlugin(pkgJson.name) || this.registry.isVerifiedPlusPlugin(pkgJson.name))
        ? pkgJson.funding
        : undefined,
      directories: pkgJson.directories,
      publicPackage: false,
      latestVersion: null,
      updateAvailable: false,
      links: {},
    }

    // Get npm data but skip the beta check (we'll do it separately with the correct preference)
    await this.registry.getPluginFromNpm(uiPackage, true)

    if (!uiPackage.latestVersion) {
      return uiPackage
    }

    // Apply update policy for Homebridge Glass UI
    const updatePolicy = this.configService.ui.homebridgeUiUpdatePolicy || 'all'

    if (updatePolicy === 'none') {
      uiPackage.updateAvailable = false
      uiPackage.latestVersion = null
    } else if (updatePolicy === 'major') {
      // Find the latest version within the same major version
      const currentMajor = Number.parseInt(uiPackage.installedVersion.split('.')[0], 10)
      const versions = await this.registry.getAvailablePluginVersions(this.configService.name)

      // Filter to versions in the same major and not deprecated
      const sameMajorVersions = Object.keys(versions.versions)
        .filter((version) => {
          const versionMajor = Number.parseInt(version.split('.')[0], 10)
          return versionMajor === currentMajor
        })
        .sort(rcompare) // Sort descending (highest first)

      if (sameMajorVersions.length > 0 && gt(sameMajorVersions[0], uiPackage.installedVersion)) {
        // There's a newer version in the same major
        uiPackage.latestVersion = sameMajorVersions[0]
        uiPackage.updateAvailable = true
        uiPackage.updateEngines = versions.versions[sameMajorVersions[0]]?.engines || null
      } else {
        // No newer version in same major
        uiPackage.updateAvailable = false
      }
    } else if (updatePolicy === 'beta') {
      await this.registry.checkForBetaUpdates(uiPackage, this.configService.name, true)
    }

    return uiPackage
  }

  /**
   * Gets the npm module details
   */
  public async getNpmPackage() {
    if (this.npmPackage) {
      return this.npmPackage
    } else {
      const modules = await this.getInstalledModules()

      const npmPkg = modules.find(x => x.name === 'npm')

      if (!npmPkg) {
        throw new Error('Could not find npm package')
      }

      const pkgJson: IPackageJson = await readJson(join(npmPkg.installPath, 'package.json'))
      const npm = await this.registry.parsePackageJson(pkgJson, npmPkg.path) as HomebridgePlugin & { showUpdateWarning?: boolean }

      // Show the update warning if the installed version is below the minimum recommended
      // I set this to 9.5.0 to match a minimum node version of 18.15.0 (bwp91)
      npm.showUpdateWarning = lt(npm.installedVersion, '9.5.0')

      this.npmPackage = npm
      return npm
    }
  }

  /**
   * Return an array of disabled plugins
   */
  private async getDisabledPlugins(): Promise<string[]> {
    try {
      const config: HomebridgeConfig = await readJson(this.configService.configPath)
      if (Array.isArray(config.disabledPlugins)) {
        return config.disabledPlugins
      } else {
        return []
      }
    } catch (e) {
      return []
    }
  }

  /**
   * Load any @scoped homebridge modules
   */
  private async getInstalledScopedModules(requiredPath: string, scope: string): Promise<InstalledModule[]> {
    try {
      if ((await stat(join(requiredPath, scope))).isDirectory()) {
        const scopedModules = (await readdir(join(requiredPath, scope))).filter(x => x.startsWith('homebridge-'))
        const hasPackageJson = await Promise.all(scopedModules.map(x => pathExists(join(requiredPath, scope, x, 'package.json'))))
        return scopedModules
          .filter((_x, i) => hasPackageJson[i])
          .map((x) => {
            return {
              name: join(scope, x).split(sep).join('/'),
              installPath: join(requiredPath, scope, x),
              path: requiredPath,
            }
          })
      } else {
        return []
      }
    } catch (e) {
      this.logger.log(e)
      return []
    }
  }

  /**
   * Returns a list of modules installed. The scan is shared by concurrent
   * callers and reused for INSTALLED_MODULES_TTL_MS; anything that changes
   * what is installed clears it (see runNpmCommand / clearInstalledPluginsCache).
   * Each caller gets its own copy of the array.
   */
  private async getInstalledModules(): Promise<InstalledModule[]> {
    const now = Date.now()
    if (!this.installedModulesCache || this.installedModulesCache.expires <= now) {
      const promise = this.scanInstalledModules()
      this.installedModulesCache = { promise, expires: now + INSTALLED_MODULES_TTL_MS }
      // A failed scan must not be served for the next minute
      promise.catch(() => {
        if (this.installedModulesCache?.promise === promise) {
          this.installedModulesCache = null
        }
      })
    }
    return (await this.installedModulesCache.promise).map(x => ({ ...x }))
  }

  private async scanInstalledModules(): Promise<InstalledModule[]> {
    const allModules = []
    // Loop over each possible path to find installed plugins
    for (const requiredPath of await this.getPaths()) {
      const modules: string[] = await readdir(requiredPath)
      for (const module of modules) {
        try {
          if (module.charAt(0) === '@') {
            allModules.push(...await this.getInstalledScopedModules(requiredPath, module))
          } else {
            const modulePath = join(requiredPath, module)
            if (await pathExists(join(modulePath, 'package.json'))) {
              allModules.push({
                name: module,
                installPath: modulePath,
                path: requiredPath,
              })
            }
          }
        } catch (e) {
          this.logger.log(`Failed to parse ${module} in ${requiredPath} as ${e.message}.`)
        }
      }
    }

    // Always include the installation we are actually running from, even when another
    // copy of the UI was found. This used to only run when no copy was found at all, so
    // a shadow copy under customPluginPath hid the real one completely: the running
    // install is not necessarily inside any scanned base path, and every 'which install
    // is us?' check downstream then had nothing to match and quietly took the shadow.
    const runningUiPath = resolve(process.env.UIX_BASE_PATH)
    if (!allModules.some(x => x.name === '@mp-consulting/homebridge-config-glass-ui' && resolve(x.installPath) === runningUiPath)) {
      allModules.push({
        name: '@mp-consulting/homebridge-config-glass-ui',
        installPath: process.env.UIX_BASE_PATH,
        path: getUiNodeModulesPath(),
      })
    }

    // Same for the Homebridge hb-service told us it launched: the apt and Pi image
    // flavours install to /opt/homebridge, which is not one of the base paths we
    // scan, so a second copy that is scanned would be the only candidate and every
    // 'which install is running?' check downstream had nothing to match (#2897).
    const runningHomebridgePath = this.configService.runningHomebridgeModulePath
    if (runningHomebridgePath) {
      let resolvedRunningPath: string
      try {
        resolvedRunningPath = await realpath(runningHomebridgePath)
      } catch (e) {
        this.logger.debug(`Failed to resolve running Homebridge module path as ${e.message}.`)
      }

      if (resolvedRunningPath && await pathExists(join(resolvedRunningPath, 'package.json'))) {
        const alreadyFound = await this.containsInstallPath(allModules, 'homebridge', resolvedRunningPath)
        if (!alreadyFound) {
          allModules.push({
            name: 'homebridge',
            installPath: resolvedRunningPath,
            path: dirname(resolvedRunningPath),
          })
        }
      }
    }

    // If homebridge not found in default locations, check the folder above
    if (allModules.findIndex(x => x.name === 'homebridge') === -1) {
      if (await pathExists(join(getUiNodeModulesPath(), 'homebridge'))) {
        allModules.push({
          name: 'homebridge',
          installPath: join(getUiNodeModulesPath(), 'homebridge'),
          path: dirname(join(getUiNodeModulesPath(), 'homebridge')),
        })
      }
    }

    return allModules
  }

  /**
   * Get the paths used by Homebridge to load plugins
   * this is the same code used by homebridge to find plugins
   * https://github.com/nfarina/homebridge/blob/c73a2885d62531925ea439b9ad6d149a285f6daa/lib/plugin.js#L105-L134
   */
  private async getBasePaths(): Promise<string[]> {
    let paths = []

    if (this.configService.customPluginPath) {
      paths.unshift(this.configService.customPluginPath)
    }

    if (this.configService.strictPluginResolution) {
      if (!paths.length) {
        paths.push(...await this.getNpmPrefixToSearchPaths())
      }
    } else {
      // In ESM, require.main is not available, so we use Module._nodeModulePaths instead
      paths = [...paths, ...module._nodeModulePaths(dirname(require.resolve.paths('.')?.[0] || process.cwd()))]

      if (process.env.NODE_PATH) {
        paths = [...process.env.NODE_PATH.split(delimiter).filter(p => !!p), ...paths]
      } else {
        // Default paths for non-windows systems
        if ((platform() !== 'win32')) {
          paths.push('/usr/local/lib/node_modules')
          paths.push('/usr/lib/node_modules')
        }
        paths.push(...await this.getNpmPrefixToSearchPaths())
      }

      // Don't look at @mp-consulting/homebridge-config-glass-ui's own modules
      paths = paths.filter(x => x !== join(process.env.UIX_BASE_PATH, 'node_modules'))
    }
    // Filter out duplicates and non-existent paths
    const uniquePaths = [...new Set(paths)]
    const exists = await Promise.all(uniquePaths.map(requiredPath => pathExists(requiredPath)))
    return uniquePaths.filter((_requiredPath, i) => exists[i])
  }

  /**
   * Get path from the npm prefix, e.g. /usr/local/lib/node_modules
   */
  private async getNpmPrefixToSearchPaths(): Promise<string[]> {
    const paths = []
    if ((platform() === 'win32')) {
      paths.push(join(process.env.APPDATA, 'npm/node_modules'))
    } else {
      try {
        const prefix = await this.queryNpm(['-g', 'prefix'], {
          npm_config_loglevel: 'silent',
          npm_update_notifier: 'false',
          ...process.env,
        })
        paths.push(`${prefix}/lib/node_modules`)
      } catch (e) {
        this.logger.debug(`Could not determine the npm global prefix: ${e.message}`)
      }
    }
    return paths
  }

  /**
   * Run a read-only npm query (e.g. `npm root -g`) and return its trimmed
   * output. Async so it never blocks the event loop - npm alone can take a
   * second or more to start on a Raspberry Pi.
   */
  public async queryNpm(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
    const options = { env, timeout: 10000 }
    // npm is a .cmd shim on Windows, which only runs through a shell. The
    // command line is built from these fixed arguments only, as it was when
    // this used execSync.
    const { stdout } = platform() === 'win32'
      ? await execAsync(['npm', ...args].join(' '), options)
      : await execFileAsync('npm', args, options)
    return stdout.toString().trim()
  }

  /**
   * The global node_modules folder (`npm root -g`), looked up once and then
   * reused. Null when npm cannot be queried - the next call tries again.
   */
  public getNpmGlobalRoot(): Promise<string | null> {
    this.npmGlobalRootPromise ??= this.queryNpm(['root', '-g']).then(root => root || null).catch((e) => {
      this.logger.debug(`Could not determine the npm global root: ${e.message}`)
      this.npmGlobalRootPromise = null
      return null
    })
    return this.npmGlobalRootPromise
  }
}
