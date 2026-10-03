/* global NodeJS */

import type {
  INpmRegistryModule,
  IPackageJson,
} from './plugins.interfaces.js'

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { constants, existsSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { arch, cpus, platform, userInfo } from 'node:os'
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path'
import process from 'node:process'

import { HttpService } from '@nestjs/axios'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { cyan, green, red, yellow } from 'bash-color'
import { createFile, ensureDir, pathExists, readJson, remove } from 'fs-extra/esm'
import { firstValueFrom } from 'rxjs'
import { satisfies } from 'semver'

import { ConfigService } from '../../core/config/config.service.js'
import { getUiNodeModulesPath } from '../../core/install-paths.js'
import { Logger } from '../../core/logger/logger.service.js'
import { NodePtyService } from '../../core/node-pty/node-pty.service.js'
import {
  RE_ENCODED_AT,
  RE_PLUGIN_NAME,
} from '../../core/regex.constants.js'
import { InstalledPluginsService } from './installed-plugins.service.js'
import { PluginRegistryService } from './plugin-registry.service.js'
import { PluginActionDto, RE_NPM_VERSION } from './plugins.dto.js'

/**
 * Installs, updates and uninstalls packages: the npm process handling, the
 * one-at-a-time package operation queue, plugin bundles and install-script
 * permissions.
 */
@Injectable()
export class PluginInstallerService {
  private _npm: Array<string> | undefined
  private npmMajorVersion: number | null = null
  private npmMajorVersionPromise: Promise<number> | null = null

  /**
   * Lazy getter for npm path - computed only when first accessed
   */
  public get npm(): Array<string> {
    if (!this._npm) {
      this._npm = this.getNpmPath()
    }
    return this._npm
  }

  /**
   * All npm package operations run through here, one at a time. npm has no
   * lock of its own: two npm processes rewriting the same node_modules tree
   * corrupt it, and `POST /plugins/update/:name` returns as soon as its npm
   * run is SCHEDULED - so back-to-back calls (the homebridge-updater plugin
   * applying several updates, updater#278) otherwise run npm concurrently.
   */
  private packageOperationQueue: Promise<unknown> = Promise.resolve()
  private packageOperationsPending = 0

  public queuePackageOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.packageOperationsPending++
    const run = this.packageOperationQueue.then(operation).finally(() => {
      this.packageOperationsPending--
    })
    // The queue lives on after a failed operation - only the caller sees the error
    this.packageOperationQueue = run.catch(() => {})
    return run
  }

  /**
   * How many package operations are running or queued, and a promise that
   * settles when the current tail of the queue has run
   */
  public get pendingPackageOperations(): number {
    return this.packageOperationsPending
  }

  public get packageOperationsSettled(): Promise<unknown> {
    return this.packageOperationQueue
  }

  constructor(
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(NodePtyService) private readonly nodePtyService: NodePtyService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PluginRegistryService) private readonly registry: PluginRegistryService,
    @Inject(InstalledPluginsService) private readonly installed: InstalledPluginsService,
  ) {}

  /**
   * Update the UI
   * @param action
   * @param pluginAction
   * @param client
   */
  private async manageUi(action: 'install' | 'uninstall', pluginAction: PluginActionDto, client: EventEmitter) {
    // Prevent uninstalling self
    if (action === 'uninstall') {
      throw new Error('Cannot uninstall the Homebridge Glass UI.')
    }

    // Legacy support for offline docker updates
    if (this.configService.dockerOfflineUpdate && pluginAction.version === 'latest') {
      await this.updateSelfOffline(client)
      return true
    }

    // Convert 'latest' into a real version
    if (action === 'install' && pluginAction.version === 'latest') {
      pluginAction.version = await this.registry.getNpmModuleLatestVersion(pluginAction.name)
    }

    const userPlatform = platform()

    // Set the default install path
    let installPath = this.configService.customPluginPath
      ? this.configService.customPluginPath
      : this.installed.loadedPlugins.find(x => x.name === this.configService.name).installPath

    // Check if the plugin is already installed
    await this.installed.getInstalledPlugins()

    // Update the installation we are actually running from. The UI carries the
    // 'homebridge-plugin' keyword, so it is deduplicated like a plugin - and that
    // deduplication prefers a non-global copy. A second copy of the UI under
    // customPluginPath would otherwise be the one updated, leaving the running
    // install untouched and the very same update offered again after the restart.
    // Note installPath here is the containing node_modules directory, not the
    // package directory, so it is the parent of UIX_BASE_PATH that must match.
    const uiPlugins = this.installed.loadedPlugins.filter(x => x.name === pluginAction.name)
    const runningParent = getUiNodeModulesPath()
    const existingPlugin = uiPlugins.find(x => resolve(x.installPath) === runningParent) ?? uiPlugins[0]

    // If the plugin is already installed, match the installation path
    if (existingPlugin) {
      installPath = existingPlugin.installPath
    }

    // Show a warning if updating @mp-consulting/homebridge-config-glass-ui on Raspberry Pi 1 / Zero
    if (cpus().length === 1 && arch() === 'arm') {
      client.emit('stdout', yellow('***************************************************************\r\n'))
      client.emit('stdout', yellow(`Please be patient while ${this.configService.name} updates.\r\n`))
      client.emit('stdout', yellow('This process may take 5-15 minutes to complete on your device.\r\n'))
      client.emit('stdout', yellow('***************************************************************\r\n\r\n'))
    }

    // Prepare flags for npm command
    const installOptions: Array<string> = []

    // Check to see if the custom plugin path is using a package.json file
    if (installPath === this.configService.customPluginPath && await pathExists(resolve(installPath, '../package.json'))) {
      installOptions.push('--save')
    }

    // Install path is one level up
    installPath = resolve(installPath, '../')

    // Set global flag
    if (!this.configService.customPluginPath || userPlatform === 'win32' || existingPlugin?.globalInstall === true) {
      installOptions.push('-g')
    }

    // If installing, set --omit=dev to prevent installing devDependencies
    installOptions.push('--omit=dev')
    const npmPluginLabel = `${pluginAction.name}@${pluginAction.version}`

    await this.applyAllowScripts(installOptions, client, pluginAction)

    // Run the npm command (cleaning the npm cache and retrying once if it failed on a corrupt cache)
    await this.runNpmCommandWithCacheRetry(
      [...this.npm, action, ...installOptions, npmPluginLabel],
      installPath,
      client,
      pluginAction.termCols,
      pluginAction.termRows,
    )

    // Ensure the custom plugin dir was not deleted
    await this.ensureCustomPluginDirExists()

    return true
  }

  /**
   * Manage a plugin, install, update or uninstall it
   * @param action
   * @param pluginAction
   * @param client
   */
  async managePlugin(action: 'install' | 'uninstall', pluginAction: PluginActionDto, client: EventEmitter) {
    // Checked before queueing, so a bad request fails straight away rather
    // than after whatever npm run is ahead of it
    this.assertValidPackageRequest(pluginAction.name, pluginAction.version)
    return this.queuePackageOperation(() => this.doManagePlugin(action, pluginAction, client))
  }

  /**
   * Validate a package name and version before they reach the npm argv.
   *
   * ⚠️ Not every caller passes through a DTO: `POST /plugins/update/:name`
   * takes the version from the query string, and a backup restore takes names
   * and versions from the uploaded archive. Unchecked, a version such as
   * `https://attacker/x.tgz` installs an arbitrary tarball, and one starting
   * with `-` is read by npm as a flag. Every install / uninstall / update runs
   * through here, so this is the one place that has to hold.
   */
  public assertValidPackageRequest(name: string | null, version?: string) {
    if (name !== null && (typeof name !== 'string' || !RE_PLUGIN_NAME.test(name))) {
      throw new BadRequestException('Invalid plugin name.')
    }
    if (version !== undefined && version !== null && version !== '' && (typeof version !== 'string' || !RE_NPM_VERSION.test(version))) {
      throw new BadRequestException('Invalid version.')
    }
  }

  private async doManagePlugin(action: 'install' | 'uninstall', pluginAction: PluginActionDto, client: EventEmitter) {
    pluginAction.version = pluginAction.version || 'latest'

    // Use a different route for the ui
    if (pluginAction.name === this.configService.name) {
      return await this.manageUi(action, pluginAction, client)
    }

    // Convert 'latest' into a real version
    if (action === 'install' && pluginAction.version === 'latest') {
      pluginAction.version = await this.registry.getNpmModuleLatestVersion(pluginAction.name)
    }

    // Grab a list of any installed plugins
    await this.installed.getInstalledPlugins()

    // Set the default install path
    let installPath = this.configService.customPluginPath
      ? this.configService.customPluginPath
      : this.installed.loadedPlugins.find(x => x.name === this.configService.name).installPath

    // Check if the plugin is currently installed
    const existingPlugin = this.installed.loadedPlugins.find(x => x.name === pluginAction.name)

    // If the plugin is already installed, match the installation path
    if (existingPlugin) {
      installPath = existingPlugin.installPath
    }

    // If the plugin is verified, check to see if we can do a bundled update
    if (action === 'install' && await this.isPluginBundleAvailable(pluginAction)) {
      try {
        await this.doPluginBundleUpdate(pluginAction, client)
        return true
      } catch (e) {
        client.emit('stdout', yellow('\r\nBundled install / update could not complete. Trying regular install / update using npm.\r\n\r\n'))
      }
    }

    // Prepare flags for npm command
    const installOptions: Array<string> = []
    let npmPluginLabel = pluginAction.name

    // Check to see if the custom plugin path is using a package.json file
    if (installPath === this.configService.customPluginPath && await pathExists(resolve(installPath, '../package.json'))) {
      installOptions.push('--save')
    }

    // Install path is one level up
    installPath = resolve(installPath, '../')

    // Set global flag
    if (!this.configService.customPluginPath || platform() === 'win32' || existingPlugin?.globalInstall === true) {
      installOptions.push('-g')
    }

    if (action === 'install') {
      // If installing, set --omit=dev to prevent installing devDependencies
      installOptions.push('--omit=dev')
      npmPluginLabel = `${pluginAction.name}@${pluginAction.version}`

      await this.applyAllowScripts(installOptions, client, pluginAction)
    }

    // Run the npm command (cleaning the npm cache and retrying once if it failed on a corrupt cache)
    await this.runNpmCommandWithCacheRetry(
      [...this.npm, action, ...installOptions, npmPluginLabel],
      installPath,
      client,
      pluginAction.termCols,
      pluginAction.termRows,
    )

    // Ensure the custom plugin dir was not deleted
    await this.ensureCustomPluginDirExists()

    return true
  }

  /**
   * Check to see if a plugin update bundle is available
   * @param pluginAction
   */
  public async isPluginBundleAvailable(pluginAction: PluginActionDto) {
    if (
      this.configService.usePluginBundles === true
      && this.configService.customPluginPath
      && this.configService.strictPluginResolution
      && pluginAction.name !== this.configService.name
      && pluginAction.version !== 'latest'
    ) {
      try {
        const repoVersion = this.getPluginReleaseTag(pluginAction.name)
        await firstValueFrom(this.httpService.head(`https://github.com/homebridge/plugins/releases/download/${repoVersion}/${pluginAction.name.replace('/', '@')}-${pluginAction.version}.sha256`))
        return true
      } catch (e) {
        return false
      }
    } else {
      return false
    }
  }

  /**
   * Update a plugin using the bundle
   * @param pluginAction
   * @param client
   */
  public async doPluginBundleUpdate(pluginAction: PluginActionDto, client: EventEmitter) {
    const pluginUpgradeInstallScriptPath = join(process.env.UIX_BASE_PATH, 'scripts/upgrade-install-plugin.sh')
    const repoVersion = this.getPluginReleaseTag(pluginAction.name)
    await this.runNpmCommand(
      [pluginUpgradeInstallScriptPath, pluginAction.name, pluginAction.version, this.configService.customPluginPath, repoVersion],
      this.configService.storagePath,
      client,
      pluginAction.termCols,
      pluginAction.termRows,
    )
    return true
  }

  private getPluginReleaseTag(pluginName: string): string {
    if (pluginName.startsWith('@')) {
      return 'v2.0.0'
    }
    const ch = pluginName.startsWith('homebridge-') ? pluginName.charAt(11) : pluginName.charAt(0)
    return ch < 'n' ? 'v2.0.0-1' : 'v2.0.0-2'
  }

  /**
   * Sets a flag telling the system to update the package next time the UI is restarted
   * Dependent on OS support - currently only supported by the homebridge/homebridge docker image
   */
  public async updateSelfOffline(client: EventEmitter) {
    client.emit('stdout', yellow(`${this.configService.name} has been scheduled to update on the next container restart.\n\r\n\r`))
    await new Promise(res => setTimeout(res, 800))

    client.emit('stdout', yellow('The Docker container will now try and restart.\n\r\n\r'))
    await new Promise(res => setTimeout(res, 800))

    client.emit('stdout', yellow('If you have not started the Docker container with ')
    + red('--restart=always') + yellow(' you may\n\rneed to manually start the container again.\n\r\n\r'))
    await new Promise(res => setTimeout(res, 800))

    client.emit('stdout', yellow('This process may take several minutes. Please be patient.\n\r'))
    await new Promise(res => setTimeout(res, 10000))

    await createFile('/homebridge/.uix-upgrade-on-restart')
  }

  /**
   * Helper function to work out where npm is
   */
  private getNpmPath() {
    if (platform() === 'win32') {
      // If running on windows find the full path to npm
      const windowsNpmPath = [
        join(process.env.APPDATA, 'npm/npm.cmd'),
        join(process.env.ProgramFiles, 'nodejs/npm.cmd'),
        join(process.env.NVM_SYMLINK || `${process.env.ProgramFiles}/nodejs`, 'npm.cmd'),
      ].filter(existsSync)

      if (windowsNpmPath.length) {
        return [windowsNpmPath[0]]
      } else {
        this.logger.error('Cannot find npm binary, you will not be able to manage plugins or update Homebridge. You might be able to fix this problem by running:')
        this.logger.error('npm install -g npm')
      }
    }
    // Linux and macOS don't require the full path to npm
    return ['npm']
  }

  /**
   * Returns the major version of the npm binary, cached after the first call.
   * Returns 0 when npm cannot be queried (the caller then skips version-gated
   * flags rather than risking an unknown-flag hard error).
   */
  private async getNpmMajorVersion(): Promise<number> {
    if (this.npmMajorVersion !== null) {
      return this.npmMajorVersion
    }
    this.npmMajorVersionPromise ??= this.installed.queryNpm(['--version'])
      .then(version => Number.parseInt(version.split('.')[0], 10) || 0)
      .catch((error) => {
        this.logger.debug(`Could not determine npm version: ${error.message}`)
        return 0
      })
      .then((major) => {
        this.npmMajorVersion = major
        this.npmMajorVersionPromise = null
        return major
      })
    return this.npmMajorVersionPromise
  }

  /**
   * npm >= 12 refuses to run dependency lifecycle scripts unless they are
   * explicitly allowlisted (#2909). Build the --allow-scripts list for a
   * plugin install: the plugin itself plus any dependencies the plugin
   * declares in its package.json `allowScripts` field (either an array of
   * package names or an object map of name -> boolean).
   *
   * `withScripts` is the subset expected to actually run an install script -
   * the declared dependencies (they are only declared because they have one)
   * plus the plugin itself only when its manifest shows one - so a
   * project-scoped install can warn about skipped scripts without naming
   * script-less packages.
   *
   * Returns empty lists when the running npm is older than 12 - passing the
   * flag there would hard-error as an unknown option. When the registry
   * lookup fails entirely the plugin's own name is still allowed (installing
   * the plugin is taken as consent for its own script), but `withScripts`
   * stays empty as nothing is known to have a script.
   */
  private async getAllowedInstallScripts(pluginName: string, pluginVersion: string): Promise<{ allowed: string[], withScripts: string[] }> {
    if (await this.getNpmMajorVersion() < 12) {
      return { allowed: [], withScripts: [] }
    }

    const allowed = new Set<string>([pluginName])
    const withScripts = new Set<string>()

    try {
      // This fetch must NOT use the minimal-projection accept header
      // (application/vnd.npm.install-v1+json) used elsewhere in this service:
      // that projection strips the `allowScripts` field this lookup exists to read.
      const pkg: INpmRegistryModule = (await firstValueFrom(
        this.httpService.get(`https://registry.npmjs.org/${encodeURIComponent(pluginName).replace(RE_ENCODED_AT, '@')}`),
      )).data
      const manifest = pkg.versions?.[pluginVersion] as (IPackageJson & { allowScripts?: unknown, hasInstallScript?: boolean }) | undefined

      if (manifest?.hasInstallScript === true || ['preinstall', 'install', 'postinstall'].some(script => manifest?.scripts?.[script])) {
        withScripts.add(`${pluginName}@${pluginVersion}`)
      }

      const declared = manifest?.allowScripts
      if (Array.isArray(declared)) {
        for (const name of declared) {
          if (typeof name === 'string' && name.length) {
            allowed.add(name)
            withScripts.add(name)
          }
        }
      } else if (declared && typeof declared === 'object') {
        for (const [name, enabled] of Object.entries(declared)) {
          if (enabled === true) {
            allowed.add(name)
            withScripts.add(name)
          }
        }
      }
    } catch (error) {
      this.logger.debug(`Could not read allowScripts for ${pluginName}@${pluginVersion}: ${error.message}`)
    }

    return { allowed: [...allowed], withScripts: [...withScripts] }
  }

  /**
   * Read the `allowScripts` field of the package.json alongside the custom
   * plugin path, or undefined when the file or field does not exist (yet).
   */
  private async getLocalAllowScripts(): Promise<unknown> {
    if (!this.configService.customPluginPath) {
      return undefined
    }
    try {
      return (await readJson(resolve(this.configService.customPluginPath, '../package.json')))?.allowScripts
    } catch {
      return undefined
    }
  }

  /**
   * For a project-scoped install npm reads script permissions from the
   * `allowScripts` field of the package.json alongside the plugins, so a
   * skipped-script warning is only warranted for packages with no verdict
   * there. An entry matches a package by name; a `false` entry is a
   * deliberate denial whatever version it names, while a `true` entry only
   * counts when it carries no version pin or the exact version being
   * installed - a stale `name@oldversion: true` pin still leaves the
   * script blocked after an update.
   */
  private filterLocallyHandledScripts(scriptPackages: string[], localAllowScripts: unknown): string[] {
    const splitKey = (key: string): { name: string, version?: string } => {
      const at = key.indexOf('@', 1)
      return at === -1 ? { name: key } : { name: key.slice(0, at), version: key.slice(at + 1) }
    }

    const entries: Array<{ name: string, version?: string, enabled: boolean }> = []
    if (Array.isArray(localAllowScripts)) {
      for (const key of localAllowScripts) {
        if (typeof key === 'string' && key.length) {
          entries.push({ ...splitKey(key), enabled: true })
        }
      }
    } else if (localAllowScripts && typeof localAllowScripts === 'object') {
      for (const [key, enabled] of Object.entries(localAllowScripts)) {
        if (typeof enabled === 'boolean') {
          entries.push({ ...splitKey(key), enabled })
        }
      }
    }

    return scriptPackages.filter((packageKey) => {
      const candidate = splitKey(packageKey)
      const matches = entries.filter(x => x.name === candidate.name)
      if (matches.some(x => !x.enabled)) {
        return false
      }
      return !matches.some(x => !x.version || !candidate.version || x.version === candidate.version)
    })
  }

  /**
   * Add `--allow-scripts` to an npm install when the running npm needs it (#2909).
   *
   * npm only accepts the flag for global installs. Passing it to a project-scoped
   * install (a custom plugin path with its own package.json) fails outright with
   * EALLOWSCRIPTS, so there we instead explain what to do - but only when a
   * script would actually be skipped: nothing is printed when neither the plugin
   * nor its declared dependencies run install scripts, or when the package.json
   * alongside the plugins already settles every script either way.
   */
  private async applyAllowScripts(installOptions: string[], client: EventEmitter, pluginAction: PluginActionDto): Promise<void> {
    const { allowed, withScripts } = await this.getAllowedInstallScripts(pluginAction.name, pluginAction.version)
    if (!allowed.length) {
      return
    }

    if (!installOptions.includes('-g')) {
      const skipped = this.filterLocallyHandledScripts(withScripts, await this.getLocalAllowScripts())
      if (skipped.length) {
        client.emit('stdout', yellow(`Install scripts for ${skipped.join(', ')} will not run: npm only accepts --allow-scripts for global installs. Add an "allowScripts" entry to the package.json alongside your plugins to permit them.\r\n\r\n`))
      }
      return
    }

    installOptions.push(`--allow-scripts=${allowed.join(',')}`)
    client.emit('stdout', yellow(`Allowing install scripts for: ${allowed.join(', ')}.\r\n\r\n`))
  }

  /**
   * Executes an NPM command
   * @param command
   * @param cwd
   * @param client
   * @param cols
   * @param rows
   */
  public async runNpmCommand(command: Array<string>, cwd: string, client: EventEmitter, cols?: number, rows?: number) {
    // Remove synology @eaDir folders from the node_modules
    await this.removeSynologyMetadata()

    let timeoutTimer: NodeJS.Timeout
    command = command.map(x => String(x)).filter(x => x.length)

    // Sudo mode is requested in plugin config
    if (this.configService.ui.sudo) {
      command.unshift('sudo', '-E', '-n')
    } else {
      // Do a pre-check to test for write access when not using sudo mode
      const npmInstallPath = await this.installed.getNpmGlobalRoot() ?? resolve(cwd, 'node_modules')
      try {
        await access(npmInstallPath, constants.W_OK)
      } catch (e) {
        client.emit('stdout', yellow(`The user "${userInfo().username}" does not have write access to the target directory:\n\r\n\r`))
        client.emit('stdout', `${npmInstallPath}\n\r\n\r`)
        client.emit('stdout', yellow('This may cause the operation to fail.\n\r'))
        client.emit('stdout', yellow('See the docs for details on how to enable sudo mode:\n\r'))
        client.emit('stdout', yellow('https://github.com/mp-consulting/homebridge-config-glass-ui/wiki/Manual-Configuration#sudo-mode\n\r\n\r'))
      }
    }

    this.logger.log(`Running command ${command.join(' ')}.`)

    if (!satisfies(process.version, `>=${this.configService.minimumNodeVersion}`)) {
      client.emit('stdout', yellow(`Node.js v${this.configService.minimumNodeVersion} higher is required for ${this.configService.name}.\n\r`))
      client.emit('stdout', yellow(`You may experience issues while running on Node.js ${process.version}.\n\r\n\r`))
    }

    // Build the npm-spawn env from a sanitised copy of process.env so a
    // malicious plugin's postinstall script cannot read secret-shaped
    // keys (cloud creds, CI tokens, *_SECRET / *_PASSWORD / *_PRIVATE_KEY)
    // that happened to be set when the UI was launched.
    const env = this.sanitizeNpmEnv(process.env)
    Object.assign(env, {
      npm_config_global_style: 'true',
      npm_config_update_notifier: 'false',
      npm_config_prefer_online: 'true',
      npm_config_foreground_scripts: 'true',
      npm_config_loglevel: 'error',
    })

    // Set global prefix for unix based systems
    if (command.includes('-g') && basename(cwd) === 'lib') {
      cwd = dirname(cwd)
      Object.assign(env, {
        npm_config_prefix: cwd,
      })
    }

    // On windows, we want to ensure the global prefix is the same as the installation path
    if (platform() === 'win32') {
      Object.assign(env, {
        npm_config_prefix: cwd,
      })
    }

    client.emit('stdout', cyan(`USER: ${userInfo().username}\n\r`))
    client.emit('stdout', cyan(`DIR: ${cwd}\n\r`))
    client.emit('stdout', cyan(`CMD: ${command.join(' ')}\n\r\n\r`))

    // The tail of npm's output, kept so a failure can be classified
    let output = ''

    this.installed.pluginManagementStarted()
    try {
      await new Promise((res, rej) => {
        const term = this.nodePtyService.spawn(command.shift(), command, {
          name: 'xterm-color',
          cols: cols || 80,
          rows: rows || 30,
          cwd,
          env,
        })

        // Send stdout data from the process to all clients
        term.onData((data) => {
          client.emit('stdout', data)
          output = (output + data).slice(-PluginInstallerService.NPM_OUTPUT_TAIL)
        })

        // Send an error message to the client if the command does not exit with code 0
        term.onExit(({ exitCode }) => {
          if (exitCode === 0) {
            clearTimeout(timeoutTimer)
            client.emit('stdout', green('\n\rOperation succeeded!.\n\r'))
            res(null)
          } else {
            clearTimeout(timeoutTimer)
            rej(Object.assign(new Error(`Operation failed with code ${exitCode}.\n\rYou can download this log file for future reference.\n\rSee https://github.com/mp-consulting/homebridge-config-glass-ui/wiki/Troubleshooting for help.`), { npmOutput: output }))
          }
        })

        // If the command spends to long trying to execute kill it after 5 minutes
        timeoutTimer = setTimeout(() => {
          term.kill('SIGTERM')
        }, 300000)
      })
    } finally {
      // Invalidate the cache only after npm exits, not before — invalidating
      // up front would let concurrent /plugins or /auth/settings calls walk
      // the filesystem mid-install and re-cache a half-installed snapshot
      // for 60s, leaving the UI showing the wrong version (or "not
      // installed") for up to a minute after success.
      this.installed.pluginManagementFinished()
    }
  }

  /**
   * Run an npm command, and if it failed because the npm cache is corrupt,
   * clean the cache and run it once more.
   *
   * The cache used to be cleaned before every install, update and uninstall,
   * which throws away every cached tarball (so npm re-downloads all of them)
   * and costs a slow `npm cache clean` on a Pi for the rare case it helps.
   */
  private async runNpmCommandWithCacheRetry(command: Array<string>, cwd: string, client: EventEmitter, cols?: number, rows?: number) {
    try {
      await this.runNpmCommand(command, cwd, client, cols, rows)
    } catch (e) {
      if (!PluginInstallerService.isNpmCacheError(e?.npmOutput)) {
        throw e
      }
      client.emit('stdout', yellow('\r\nThe npm cache looks corrupt. Cleaning it and trying again.\r\n\r\n'))
      await this.cleanNpmCache()
      await this.runNpmCommand(command, cwd, client, cols, rows)
    }
  }

  /** How much of npm's output (characters) is kept to classify a failure. */
  private static readonly NPM_OUTPUT_TAIL = 16 * 1024

  /** Whether npm's output shows a failure a clean cache can fix (integrity mismatch, missing or damaged cache entries). */
  public static isNpmCacheError(output: unknown): boolean {
    return typeof output === 'string'
      && /\b(?:EINTEGRITY|ENOTCACHED|ECOMPROMISED)\b|integrity checksum failed|_cacache|cache (?:is )?corrupt/i.test(output)
  }

  /**
   * When npm removes the last plugin in a custom node_modules location it may delete this location
   * which will cause errors. This function ensures the plugin directory is recreated if it was removed.
   */
  private async ensureCustomPluginDirExists() {
    if (!this.configService.customPluginPath) {
      return
    }

    if (!await pathExists(this.configService.customPluginPath)) {
      this.logger.warn(`Custom plugin directory was removed, re-creating ${this.configService.customPluginPath}.`)
      try {
        await ensureDir(this.configService.customPluginPath)
      } catch (e) {
        this.logger.error(`Failed to re-create custom plugin directory as ${e.message}.`)
      }
    }
  }

  /**
   * Build a copy of `process.env` with secret-shaped keys removed before
   * spawning npm. A malicious plugin's postinstall script runs in this
   * env; without the strip, anything the UI inherited (AWS keys, CI
   * tokens, custom *_PASSWORD vars) would be readable by the script.
   *
   * Conservative strip: drop common cloud / CI credential prefixes plus a
   * pattern match for `SECRET`, `PASSWORD`, `PASSWD`, `PRIVATE_KEY`, and
   * trailing-`_TOKEN`. Everything else (PATH, HOME, locale, npm_*,
   * HOMEBRIDGE_*, UIX_*) passes through unchanged because npm and many
   * plugin postinstall steps legitimately depend on it.
   */
  public sanitizeNpmEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const droppedPrefixes = ['AWS_', 'AZURE_', 'GOOGLE_APPLICATION_', 'GCP_']
    const droppedExact = new Set(['GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN'])
    const droppedPattern = /SECRET|PASSWORD|PASSWD|PRIVATE_KEY|_TOKEN$/i
    const result: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(env)) {
      if (droppedExact.has(key)) {
        continue
      }
      if (droppedPrefixes.some(prefix => key.startsWith(prefix))) {
        continue
      }
      if (droppedPattern.test(key)) {
        continue
      }
      result[key] = value
    }
    return result
  }

  /**
   * Remove the Synology @eaDir directories from the plugin folder
   */
  private async removeSynologyMetadata() {
    if (!this.configService.customPluginPath) {
      return
    }

    const offendingPath = resolve(this.configService.customPluginPath, '@eaDir')

    try {
      if (!await pathExists(offendingPath)) {
        await remove(offendingPath)
      }
    } catch (e) {
      this.logger.error(`Failed to remove ${offendingPath} as ${e.message}.`)
    }
  }

  /**
   * Clean the npm cache
   * npm cache clean --force
   */
  private async cleanNpmCache() {
    const command: string[] = [...this.npm, 'cache', 'clean', '--force']

    if (this.configService.ui.sudo) {
      command.unshift('sudo', '-E', '-n')
    }

    return new Promise((res) => {
      // Array form: this.npm[0] is derived from env vars on Windows, so
      // shell-mode spawn would let any metacharacters in it be interpreted.
      // Node 20+ throws EINVAL synchronously when spawning a .cmd/.bat
      // without shell:true (CVE-2024-27980), and cache clean is
      // best-effort, so swallow either failure mode and continue.
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(command[0], command.slice(1))
      } catch (e) {
        this.logger.warn(`Skipped npm cache clean as ${e.message}.`)
        res(null)
        return
      }

      child.on('exit', (code) => {
        this.logger.log(`Executed npm cache clear command with exit code ${code}.`)
        res(null)
      })

      child.on('error', () => {
        res(null)
      })
    })
  }
}
