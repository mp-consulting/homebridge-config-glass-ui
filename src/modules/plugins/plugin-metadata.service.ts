import type { HomebridgeConfig } from '../../core/config/config.interfaces.js'
import type {
  HomebridgePlugin,
  HomebridgePluginUiMetadata,
  INpmRegistryModule,
  PluginAlias,
} from './plugins.interfaces.js'

import { Buffer } from 'node:buffer'
import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import {
  resolve,
  sep,
} from 'node:path'
import process from 'node:process'

import { HttpService } from '@nestjs/axios'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { pathExists, readJson } from 'fs-extra/esm'
import NodeCache from 'node-cache'
import pLimit from 'p-limit'
import { firstValueFrom } from 'rxjs'

import { ConfigService } from '../../core/config/config.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import {
  RE_ENCODED_AT,
  RE_GITHUB_REPO,
  RE_PRERELEASE_TYPE,
} from '../../core/regex.constants.js'
import { ChildBridgesService } from '../child-bridges/child-bridges.service.js'
import { InstalledPluginsService } from './installed-plugins.service.js'
import { PluginRegistryService } from './plugin-registry.service.js'

// Alias extraction forks a Node process per schema-less plugin. Unbounded, a
// page listing every plugin (or an Update All plan) forks them all at once,
// which can stall a Raspberry Pi for seconds - so at most two run at a time,
// across every caller.
const pluginAliasForkLimit = pLimit(2)

/**
 * Per-plugin metadata: config schemas, alias lookups, config blocks, custom
 * UI metadata, and changelogs / release notes.
 */
@Injectable()
export class PluginMetadataService {
  // Create a cache for storing plugin alias
  private pluginAliasCache = new NodeCache({ stdTTL: 86400 })

  // In-flight alias lookups per plugin, so concurrent callers for the same
  // plugin share one extraction instead of forking one process each
  private pluginAliasLookups = new Map<string, Promise<PluginAlias>>()

  /**
   * Define the alias / type some plugins without a schema where the extract method does not work
   */
  private pluginAliasHints = {
    'homebridge-broadlink-rm-pro': {
      pluginAlias: 'BroadlinkRM',
      pluginType: 'platform',
    },
  }

  constructor(
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(ChildBridgesService) private readonly childBridgesService: ChildBridgesService,
    @Inject(PluginRegistryService) private readonly registry: PluginRegistryService,
    @Inject(InstalledPluginsService) private readonly installed: InstalledPluginsService,
  ) {}

  /**
   * Returns the config.schema.json for the plugin
   * @param pluginName
   */
  public async getPluginConfigSchema(pluginName: string) {
    if (!this.installed.loadedPlugins) {
      await this.installed.getInstalledPlugins()
    }
    const plugin = this.installed.loadedPlugins.find(x => x.name === pluginName)
    if (!plugin) {
      throw new NotFoundException()
    }

    if (!plugin.settingsSchema) {
      throw new NotFoundException()
    }

    let schemaPath: string

    const i18nPath = plugin.directories?.schemas
    if (i18nPath) {
      const lang = this.configService.ui.lang === 'auto' ? 'en' : this.configService.ui.lang

      if (lang && lang !== 'en' && lang !== 'auto') {
        const i18nSchemaPath = resolve(plugin.installPath, pluginName, i18nPath, `config.schema.${lang}.json`)
        if (existsSync(i18nSchemaPath)) {
          schemaPath = i18nSchemaPath
        }
      }
    }

    schemaPath ??= resolve(plugin.installPath, pluginName, 'config.schema.json')

    let configSchema = await readJson(schemaPath)

    // check to see if this plugin implements dynamic schemas
    if (configSchema.dynamicSchemaVersion) {
      const dynamicSchemaPath = resolve(this.configService.storagePath, `.${pluginName}-v${configSchema.dynamicSchemaVersion}.schema.json`)
      // `dynamicSchemaVersion` is plugin-controlled; resolve() folds any
      // `../` segments before we hit `readJson`. Without this guard a
      // crafted version string could escape `storagePath` and surface
      // any JSON-parseable file on the host through the schema endpoint.
      const storageBoundary = this.configService.storagePath + sep
      if (!dynamicSchemaPath.startsWith(storageBoundary)) {
        this.logger.warn(`[${pluginName}] ignoring dynamic schema path ${dynamicSchemaPath} — outside storage directory.`)
      } else {
        this.logger.log(`[${pluginName}] dynamic schema path: ${dynamicSchemaPath}.`)
        if (existsSync(dynamicSchemaPath)) {
          try {
            configSchema = await readJson(dynamicSchemaPath)
            this.logger.log(`[${pluginName}] dynamic schema loaded from ${dynamicSchemaPath}.`)
          } catch (e) {
            this.logger.error(`[${pluginName}] failed to load dynamic schema from ${dynamicSchemaPath} as ${e.message}.`)
          }
        }
      }
    }

    // Modify this plugins schema to set the default port number
    if (pluginName === this.configService.name) {
      configSchema.schema.properties.port.default = this.configService.ui.port
    }

    // Modify homebridge-alexa to set the default pin
    if (pluginName === 'homebridge-alexa') {
      configSchema.schema.properties.pin.default = this.configService.homebridgeConfig.bridge.pin
    }

    // Add the display name from the config.json
    if (plugin.displayName) {
      configSchema.displayName = plugin.displayName
    }

    // Inject schema for _bridge child bridge setting (this is hidden, but prevents it getting removed)
    const childBridgeSchema = {
      type: 'object',
      notitle: true,
      condition: {
        functionBody: 'return false',
      },
      properties: {
        name: {
          type: 'string',
        },
        username: {
          type: 'string',
        },
        pin: {
          type: 'string',
        },
        port: {
          type: 'integer',
          maximum: 65535,
        },
        setupID: {
          type: 'string',
        },
        manufacturer: {
          type: 'string',
        },
        firmwareRevision: {
          type: 'string',
        },
        model: {
          type: 'string',
        },
        debugModeEnabled: {
          type: 'boolean',
        },
        env: {
          type: 'object',
          properties: {
            DEBUG: {
              type: 'string',
            },
            NODE_OPTIONS: {
              type: 'string',
            },
          },
        },
        matter: {
          type: 'object',
          properties: {
            port: {
              type: 'integer',
              maximum: 65535,
            },
          },
        },
      },
    }

    if (configSchema.schema && typeof configSchema.schema.properties === 'object') {
      configSchema.schema.properties._bridge = childBridgeSchema
    } else if (typeof configSchema.schema === 'object') {
      configSchema.schema._bridge = childBridgeSchema
    }

    return configSchema
  }

  /**
   * Returns the changelog from the npm package for a plugin
   * @param pluginName
   */
  public async getPluginChangeLog(pluginName: string) {
    await this.installed.getInstalledPlugins()
    const plugin = this.installed.loadedPlugins.find(x => x.name === pluginName)
    if (!plugin) {
      throw new NotFoundException()
    }

    const changeLog = resolve(plugin.installPath, plugin.name, 'CHANGELOG.md')

    if (await pathExists(changeLog)) {
      return {
        changelog: await readFile(changeLog, 'utf8'),
      }
    } else {
      throw new NotFoundException()
    }
  }

  /**
   * Get the GitHub release notes and changelog for a specific version of a plugin
   * @param pluginName
   * @param version - A specific semver (e.g. "1.2.3", "1.2.3-beta.8") or dist-tag (e.g. "latest", "beta")
   */
  public async getPluginRelease(pluginName: string, version?: string) {
    let latestVersion: string | null = null
    let resolvedVersion: string | null = null

    try {
      const pkg: INpmRegistryModule = (await firstValueFrom((
        this.httpService.get(`https://registry.npmjs.org/${encodeURIComponent(pluginName).replace(RE_ENCODED_AT, '@')}`)),
      )).data

      latestVersion = pkg['dist-tags'] ? pkg['dist-tags'].latest : null

      // Resolve the requested version
      if (!version || version === 'latest') {
        resolvedVersion = latestVersion
      } else if (pkg['dist-tags']?.[version]) {
        // version is a dist-tag name (e.g. "beta", "next") — resolve to its semver
        resolvedVersion = pkg['dist-tags'][version]
      } else {
        // version is already a specific semver
        resolvedVersion = version
      }
    } catch (e) {
      throw new NotFoundException()
    }

    // Helper to fetch a GitHub release by tag, trying v-prefixed first then bare version
    const fetchReleaseByVersion = async (owner: string, repo: string, ver: string) => {
      for (const tag of [`v${ver}`, ver]) {
        try {
          const release = await firstValueFrom(this.httpService.get(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`))
          return release.data
        } catch { }
      }
      return null
    }

    // Determine if this is a prerelease version (e.g. "1.2.3-beta.1") and extract the prerelease type
    const prereleaseType = resolvedVersion?.match(RE_PRERELEASE_TYPE)?.[1] ?? null

    // Helper to find the most recently updated branch containing a keyword (e.g. "beta")
    const findPrereleaseBranch = async (owner: string, repo: string, keyword: string): Promise<string | null> => {
      try {
        const response = await firstValueFrom(this.httpService.get(`https://api.github.com/repos/${owner}/${repo}/branches`, {
          params: { per_page: 100 },
        }))
        const matched = response.data.filter((b: any) => b.name.includes(keyword))
        return matched.length > 0 ? matched.at(-1).name : null
      } catch { }
      return null
    }

    switch (pluginName) {
      case 'homebridge':
      case '@mp-consulting/homebridge-config-glass-ui': {
        try {
          // Release notes live in the GitHub repo that publishes each package
          const [owner, repo] = pluginName === 'homebridge' ? ['homebridge', 'homebridge'] : ['mp-consulting', 'homebridge-config-glass-ui']
          const tag = resolvedVersion ? `v${resolvedVersion}` : null
          const release = tag
            ? await firstValueFrom(this.httpService.get(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`)).then(r => r.data).catch(() => null)
            : null

          // Fetch changelog: try prerelease branch first for beta/alpha/test, then tag, then HEAD
          let changelogData: string | null = null
          if (prereleaseType) {
            const branch = await findPrereleaseBranch(owner, repo, prereleaseType)
            if (branch) {
              try {
                const changelog = await firstValueFrom(this.httpService.get(`https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${branch}/CHANGELOG.md`))
                changelogData = changelog.data
              } catch { }
            }
          }
          if (!changelogData && tag) {
            try {
              const changelog = await firstValueFrom(this.httpService.get(`https://raw.githubusercontent.com/${owner}/${repo}/refs/tags/${tag}/CHANGELOG.md`))
              changelogData = changelog.data
            } catch { }
          }
          if (!changelogData) {
            try {
              const changelog = await firstValueFrom(this.httpService.get(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/CHANGELOG.md`))
              changelogData = changelog.data
            } catch { }
          }

          return {
            name: release?.tag_name ?? null,
            notes: release?.body ?? null,
            changelog: changelogData,
            latestVersion,
          }
        } catch {
          return {
            name: null,
            notes: null,
            changelog: null,
            latestVersion,
          }
        }
      }
      default: {
        await this.installed.getInstalledPlugins()
        const plugin = this.installed.loadedPlugins.find(x => x.name === pluginName)
        if (!plugin) {
          throw new NotFoundException()
        }

        // Plugin must have a homepage to work out Git Repo
        // Some plugins have a custom homepage, so often we can also use the bugs link too
        if (!plugin.links.homepage && !plugin.links.bugs) {
          throw new NotFoundException()
        }

        // Make sure the repo is GitHub
        const repoMatch = plugin.links.homepage?.match(RE_GITHUB_REPO)
        const bugsMatch = plugin.links.bugs?.match(RE_GITHUB_REPO)
        let match: RegExpMatchArray | null = repoMatch
        if (!repoMatch) {
          if (!bugsMatch) {
            throw new NotFoundException()
          }
          match = bugsMatch
        }

        // The plugin may have a custom changelog path from this.pluginChangelogs[pkg.package.name]
        const changelogPath = this.registry.getPluginChangelogPath(pluginName) || ''

        // Helper to fetch a CHANGELOG.md from the repo, trying both cases
        const fetchChangelog = async (ref: string): Promise<string | null> => {
          for (const filename of ['CHANGELOG.md', 'changelog.md']) {
            try {
              const changelog = await firstValueFrom(this.httpService.get(`https://raw.githubusercontent.com/${match[1]}/${match[2]}/${ref}/${changelogPath}${filename}`))
              return changelog.data
            } catch { }
          }
          return null
        }

        try {
          const release = resolvedVersion
            ? await fetchReleaseByVersion(match[1], match[2], resolvedVersion)
            : null

          const releaseTag = release?.tag_name

          // For prerelease versions, try the matching branch first for the changelog
          let changelogData: string | null = null
          if (prereleaseType) {
            const branch = await findPrereleaseBranch(match[1], match[2], prereleaseType)
            if (branch) {
              changelogData = await fetchChangelog(`refs/heads/${branch}`)
            }
          }
          if (!changelogData) {
            const changelogRef = releaseTag ? `refs/tags/${releaseTag}` : 'HEAD'
            changelogData = await fetchChangelog(changelogRef)
          }

          return {
            name: releaseTag ?? null,
            notes: release?.body ?? null,
            changelog: changelogData,
            latestVersion,
          }
        } catch (e) {
          // No releases found — try prerelease branch, then fall back to default branch
          let changelogData: string | null = null
          if (prereleaseType) {
            const branch = await findPrereleaseBranch(match[1], match[2], prereleaseType)
            if (branch) {
              changelogData = await fetchChangelog(`refs/heads/${branch}`)
            }
          }
          if (!changelogData) {
            changelogData = await fetchChangelog('HEAD')
          }
          if (changelogData) {
            return {
              name: null,
              notes: null,
              changelog: changelogData,
              latestVersion,
            }
          }

          throw new NotFoundException()
        }
      }
    }
  }

  /**
   * Attempt to extract the alias from a plugin
   */
  public async getPluginAlias(pluginName: string): Promise<PluginAlias> {
    if (!this.installed.loadedPlugins) {
      await this.installed.getInstalledPlugins()
    }
    const plugin = this.installed.loadedPlugins.find(x => x.name === pluginName)

    if (!plugin) {
      throw new NotFoundException()
    }

    const fromCache: PluginAlias | undefined = this.pluginAliasCache.get(pluginName)
    if (fromCache as any) {
      return fromCache
    }

    let lookup = this.pluginAliasLookups.get(pluginName)
    if (!lookup) {
      lookup = this.extractPluginAlias(plugin).finally(() => {
        this.pluginAliasLookups.delete(pluginName)
      })
      this.pluginAliasLookups.set(pluginName, lookup)
    }
    return lookup
  }

  /**
   * Work out a plugin's alias from its schema or, failing that, by loading
   * it in a forked process. Callers go through getPluginAlias, which caches
   * the result and dedupes concurrent lookups.
   */
  private async extractPluginAlias(plugin: HomebridgePlugin): Promise<PluginAlias> {
    const pluginName = plugin.name
    const output = {
      pluginAlias: null,
      pluginType: null,
    }

    if (plugin.settingsSchema) {
      const schema = await this.getPluginConfigSchema(pluginName)
      output.pluginAlias = schema.pluginAlias
      output.pluginType = schema.pluginType
    } else {
      try {
        await pluginAliasForkLimit(() => new Promise((res, rej) => {
          const child = fork(resolve(process.env.UIX_BASE_PATH, 'scripts/extract-plugin-alias.js'), {
            env: {
              UIX_EXTRACT_PLUGIN_PATH: resolve(plugin.installPath, plugin.name),
            },
            stdio: 'ignore',
          })

          child.once('message', (data: any) => {
            if (data.pluginAlias && data.pluginType) {
              output.pluginAlias = data.pluginAlias
              output.pluginType = data.pluginType
              res(null)
            } else {
              rej(new Error('Invalid Response'))
            }
          })

          // A fork that fails to start must still settle, or it would hold
          // one of the limited slots forever
          child.once('error', rej)

          child.once('close', (code) => {
            if (code !== 0) {
              // eslint-disable-next-line unicorn/error-message
              rej(new Error())
            }
          })
        }))
      } catch (e) {
        this.logger.debug(`Failed to extract ${pluginName} plugin alias as ${e.message}.`)
        // Fallback to the manual list, if defined for this plugin
        if (this.pluginAliasHints[pluginName]) {
          output.pluginAlias = this.pluginAliasHints[pluginName].pluginAlias
          output.pluginType = this.pluginAliasHints[pluginName].pluginType
        }
      }
    }

    this.pluginAliasCache.set(pluginName, output)
    return output
  }

  /**
   * Aggregated payload used by plugin editor modals — collapses the
   * historical four-call fan-out (alias + schema + config blocks + child
   * bridges) into a single response.
   */
  public async getEditorContext(pluginName: string) {
    const [alias, configSchema, config, allChildBridges] = await Promise.all([
      this.getPluginAlias(pluginName),
      this.getPluginConfigSchemaSafe(pluginName),
      this.getConfigBlocksForPlugin(pluginName),
      this.childBridgesService.getChildBridges(),
    ])

    return {
      pluginName,
      alias,
      configSchema,
      config,
      childBridges: allChildBridges.filter(b => b.plugin === pluginName),
    }
  }

  private async getPluginConfigSchemaSafe(pluginName: string) {
    try {
      return await this.getPluginConfigSchema(pluginName)
    } catch (e) {
      if (e instanceof NotFoundException) {
        return null
      }
      throw e
    }
  }

  private async getConfigBlocksForPlugin(pluginName: string): Promise<any[]> {
    const alias = await this.getPluginAlias(pluginName)
    if (!alias.pluginAlias) {
      return []
    }

    const config: HomebridgeConfig = await readJson(this.configService.configPath)
    return this.filterConfigBlocksForPlugin(config, pluginName, alias)
  }

  private filterConfigBlocksForPlugin(config: HomebridgeConfig, pluginName: string, alias: PluginAlias): any[] {
    if (!alias.pluginAlias) {
      return []
    }
    const arrayKey = alias.pluginType === 'accessory' ? 'accessories' : 'platforms'
    const blocks = (config[arrayKey] ?? []) as any[]
    return blocks.filter(block =>
      block[alias.pluginType] === alias.pluginAlias
      || block[alias.pluginType] === `${pluginName}.${alias.pluginAlias}`,
    )
  }

  /**
   * Like `getInstalledPlugins`, but attaches a `config` field to each
   * plugin holding its saved config blocks from `config.json`. Reads the
   * config file once and reuses cached alias lookups so this scales O(N)
   * over installed plugins without N disk reads.
   */
  public async getInstalledPluginsWithConfig(): Promise<HomebridgePlugin[]> {
    const plugins = await this.installed.getInstalledPlugins()
    let config: HomebridgeConfig
    try {
      config = await readJson(this.configService.configPath)
    } catch (e) {
      this.logger.error(`Failed to read config.json while attaching plugin config blocks: ${e.message}.`)
      return plugins.map(plugin => ({ ...plugin, config: [] }))
    }

    return Promise.all(plugins.map(async (plugin) => {
      try {
        const alias = await this.getPluginAlias(plugin.name)
        return { ...plugin, config: this.filterConfigBlocksForPlugin(config, plugin.name, alias) }
      } catch (e) {
        this.logger.error(`Failed to attach config blocks for plugin ${plugin.name}: ${e.message}.`)
        return { ...plugin, config: [] }
      }
    }))
  }

  /**
   * Get the child bridge username(s) for a plugin if it's running in a child bridge
   * Returns an empty array if the plugin is not running in a child bridge
   * @param pluginName - The name of the plugin to check
   * @param config - An already-parsed config.json, so a caller checking many plugins at once reads the file only once
   * @returns Array of unique child bridge usernames
   */
  public async getPluginChildBridgeUsernames(pluginName: string, config?: HomebridgeConfig): Promise<string[]> {
    try {
      // Get plugin alias information
      const plugin = await this.getPluginAlias(pluginName)
      if (!plugin.pluginAlias) {
        return []
      }

      // Read the config file
      config ??= await readJson(this.configService.configPath) as HomebridgeConfig

      const arrayKey = plugin.pluginType === 'accessory' ? 'accessories' : 'platforms'
      const usernamesSet = new Set<string>()

      // Find all config blocks for this plugin that have a _bridge property
      const pluginBlocks = config[arrayKey]?.filter((block) => {
        const matchesPlugin = block[plugin.pluginType] === plugin.pluginAlias
          || block[plugin.pluginType] === `${pluginName}.${plugin.pluginAlias}`
        return matchesPlugin && block._bridge?.username
      }) || []

      // Extract unique usernames
      for (const block of pluginBlocks) {
        if (block._bridge?.username) {
          usernamesSet.add(block._bridge.username)
        }
      }

      return [...usernamesSet]
    } catch (e) {
      this.logger.error(`Failed to get child bridge usernames for ${pluginName}: ${e.message}`)
      return []
    }
  }

  /**
   * Returns the custom ui path for a plugin
   */
  public async getPluginUiMetadata(pluginName: string): Promise<HomebridgePluginUiMetadata> {
    if (!this.installed.loadedPlugins) {
      await this.installed.getInstalledPlugins()
    }
    const plugin = this.installed.loadedPlugins.find(x => x.name === pluginName)
    const fullPath = resolve(plugin.installPath, plugin.name)

    const schema = await readJson(resolve(fullPath, 'config.schema.json'))
    const customUiPath = resolve(fullPath, schema.customUiPath || 'homebridge-ui')
    const customUiCspDomains = this.sanitizeCspDomains(schema.customUiCspDomains)

    const publicPath = resolve(customUiPath, 'public')
    const serverPath = resolve(customUiPath, 'server.js')
    const devServer = plugin.private ? schema.customUiDevServer : null

    if (!devServer && !await pathExists(customUiPath)) {
      throw new Error(`Plugin does not provide a custom UI at expected location: ${customUiPath}`)
    }

    if (!devServer && !(await realpath(customUiPath)).startsWith(await realpath(fullPath))) {
      throw new Error(`Custom UI path is outside the plugin root: ${await realpath(customUiPath)}`)
    }

    if (await pathExists(resolve(publicPath, 'index.html')) || devServer) {
      return {
        devServer,
        serverPath,
        publicPath,
        plugin,
        customUiCspDomains,
      }
    }

    throw new Error('Plugin does not provide a custom UI')
  }

  private sanitizeCspDomains(domains: unknown): string[] {
    if (!Array.isArray(domains)) {
      return []
    }
    // Only allow https://<domain>.<tld> style domains, no paths or query strings
    const RE_VALID_CSP_DOMAIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i
    return domains
      .filter((d): d is string => {
        if (typeof d !== 'string') {
          return false
        }
        if (Buffer.byteLength(d, 'utf8') > 256) {
          this.logger.error('Ignoring customUiCspDomains entry longer than 256 bytes.')
          return false
        }
        return RE_VALID_CSP_DOMAIN.test(d)
      })
      .slice(0, 10) // hard cap to stop a runaway/malicious schema
  }
}
