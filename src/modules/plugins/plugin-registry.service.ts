/* global NodeJS */

import type {
  HomebridgePlugin,
  HomebridgePluginVersions,
  INpmRegistryModule,
  INpmSearchResults,
  InstalledPluginsSource,
  IPackageJson,
  PluginListData,
  PluginListItem,
  PluginListNewScopeItem,
} from './plugins.interfaces.js'

import {
  resolve,
} from 'node:path'

import { HttpService } from '@nestjs/axios'
import { BadRequestException, Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { pathExists } from 'fs-extra/esm'
import NodeCache from 'node-cache'
import { firstValueFrom } from 'rxjs'
import { gt, parse } from 'semver'

import { ConfigService } from '../../core/config/config.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import {
  RE_ENCODED_AT,
  RE_HYPHEN,
  RE_HYPHEN_GLOBAL,
  RE_PLUGIN_NAME,
  RE_URL,
  RE_URL_WITH_OPTIONAL_PAREN,
  RE_WHITESPACE,
  RE_WORD_SEQUENCE,
} from '../../core/regex.constants.js'

/**
 * The npm registry and the homebridge plugin list: plugin search, version
 * lookups, the npm document cache and the per-plugin data (verified, icons,
 * authors, ...) that the plugin list adds to a package.
 */
@Injectable()
export class PluginRegistryService {
  /** A search term shorter than this does not trigger @homebridge-plugins/* lookups. */
  static readonly MIN_SCOPED_TERM_LENGTH = 3
  /** The most @homebridge-plugins/* packuments one search fetches. */
  static readonly MAX_SCOPED_LOOKUPS = 10

  // Plugin list cache
  private pluginListUrl = 'https://raw.githubusercontent.com/homebridge/plugins/latest/'
  private pluginListFile = `${this.pluginListUrl}assets/plugins-v2.min.json`
  private pluginListRetryTimeout: NodeJS.Timeout

  private hiddenPlugins: string[] = []
  private hiddenScopes: string[] = []
  private unmaintainedPlugins: string[] = []
  private pluginIcons: { [key: string]: string } = {}
  private pluginAuthors: { [key: string]: string } = {}
  private pluginNames: { [key: string]: string } = {}
  private pluginChangelogs: { [key: string]: string } = {}
  private newScopePlugins: { [key: string]: PluginListNewScopeItem } = {}
  private scopedPluginNames: string[] = []
  private verifiedPlugins: string[] = []
  private verifiedPlusPlugins: string[] = []

  // Create a cache for storing plugin package.json from npm. The registry
  // documents run to megabytes for long-lived plugins, so they are cached by
  // reference (`useClones: false`) rather than deep-cloned on every read:
  // callers must treat them as read-only. Each kind of document has its own
  // key prefix - `versions-` (abbreviated install-v1 doc), `package-` (full
  // packument) and the bare plugin name (the `/latest` manifest) - since they
  // hold different fields for the same plugin.
  private npmPluginCache = new NodeCache({ stdTTL: 300, useClones: false })

  constructor(
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    /**
     * The "timeout" option on axios is the response timeout
     * If the user has no internet, the dns lookup may take a long time to timeout
     * As the dns lookup timeout is not configurable in Node.js, this interceptor
     * will cancel the request after 35 seconds.
     * AbortSignal.timeout rather than a CancelToken plus setTimeout: the timer
     * then goes away with the signal instead of lingering for 35s after every
     * request that has long since finished. A caller's own signal wins.
     */
    this.httpService.axiosRef.interceptors.request.use((config) => {
      if (!config.signal) {
        config.signal = AbortSignal.timeout(35_000)
      }
      return config
    })

    // Load the verified plugins list on init, then update every 12 hours
    this.loadPluginList().catch((err) => {
      this.logger.error('Failed to load plugin list during initialization:', err)
    })
    setInterval(this.loadPluginList.bind(this), 60000 * 60 * 12)
  }

  /**
   * Assign a display name to a plugin
   * @param plugin
   * @private
   */
  public fixDisplayName(plugin: HomebridgePlugin): HomebridgePlugin {
    plugin.displayName = plugin.displayName || (plugin.name.charAt(0) === '@' ? plugin.name.split('/')[1] : plugin.name)
      .replace(RE_HYPHEN_GLOBAL, ' ')
      .replace(RE_WORD_SEQUENCE, (txt: string) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase())
    return plugin
  }

  /**
   * Look up a single plugin in the npm registry
   * @param pluginName
   */
  public async lookupPlugin(pluginName: string, installed: InstalledPluginsSource): Promise<HomebridgePlugin> {
    if (!RE_PLUGIN_NAME.test(pluginName)) {
      throw new BadRequestException('Invalid plugin name.')
    }

    const lookup = await this.searchNpmRegistrySingle(pluginName, installed)

    if (!lookup.length) {
      throw new NotFoundException()
    }

    return lookup[0]
  }

  public async getAvailablePluginVersions(pluginName: string): Promise<HomebridgePluginVersions> {
    if (!RE_PLUGIN_NAME.test(pluginName) && pluginName !== 'homebridge') {
      throw new BadRequestException('Invalid plugin name.')
    }

    try {
      const fromCache = this.npmPluginCache.get<INpmRegistryModule>(`versions-${pluginName}`)

      const pkg: INpmRegistryModule = fromCache || (await firstValueFrom((
        this.httpService.get(`https://registry.npmjs.org/${encodeURIComponent(pluginName).replace(RE_ENCODED_AT, '@')}`, {
          headers: {
            accept: 'application/vnd.npm.install-v1+json', // only return minimal information
          },
        })),
      )).data

      if (!fromCache) {
        this.npmPluginCache.set(`versions-${pluginName}`, pkg, 60)
      }

      return {
        tags: pkg['dist-tags'],
        versions: Object.keys(pkg.versions).reduce((acc, key) => {
          if (!pkg.versions[key].deprecated) {
            acc[key] = {
              version: pkg.versions[key].version,
              engines: pkg.versions[key].engines || null,
            }
          }
          return acc
        }, {}),
      }
    } catch (e) {
      throw new NotFoundException()
    }
  }

  private extractTerms(query: string, separator: RegExp): string[] {
    return query
      .toLowerCase()
      .split(separator)
      .map(term => term.trim())
      .filter(term => term && term !== 'homebridge' && term !== 'plugin')
  }

  private getPluginKeywords(plugin: any): string[] {
    return Array.isArray(plugin.keywords)
      ? plugin.keywords.map((k: string) => k.toLowerCase())
      : []
  }

  /**
   * Whether a plugin advertises that it can expose accessories to Matter.
   *
   * Plugin authors opt in by adding the `supports-matter` keyword to their
   * package.json, the same way they already add `homebridge-plugin`. Reading it
   * from the package itself means the flag travels with the plugin, so it works
   * for private and locally installed plugins too.
   */
  public supportsMatter(keywords?: string[]): boolean {
    return Array.isArray(keywords) && keywords.some(k => k?.toLowerCase() === 'supports-matter')
  }

  /**
   * Whether a plugin advertises that it exposes accessories over HAP.
   *
   * Companion to `supports-matter`: declaring either transport keyword makes
   * the declaration complete, so `supports-matter` without `supports-hap`
   * marks a Matter-only plugin whose new child bridges should not publish a
   * HAP bridge (#3975). Plugins declaring neither keyword keep today's
   * behaviour and are treated as HAP plugins.
   */
  public supportsHap(keywords?: string[]): boolean {
    return Array.isArray(keywords) && keywords.some(k => k?.toLowerCase() === 'supports-hap')
  }

  private matchesPlugin(plugin: HomebridgePlugin, searchTerms: string[]): 'exactName' | 'exactKeyword' | 'partial' | null {
    const pluginName = plugin.name.toLowerCase()
    const pluginKeywords = this.getPluginKeywords(plugin)
    const pluginDescription = (plugin.description || '').toLowerCase()

    // Separator: '-' character, only get the terms from the plugin name, ignoring any scope
    const nameTerms = this.extractTerms(pluginName.substring(pluginName.lastIndexOf('/') + 1), RE_HYPHEN)

    // Convert arrays to Sets for faster lookup
    const searchTermsSet = new Set(searchTerms)
    const keywordsSet = new Set(pluginKeywords)
    const nameTermsSet = new Set(nameTerms)

    // The search terms contain all the parts of the name
    if (nameTerms.every(term => searchTermsSet.has(term))) {
      return 'exactName'
    }
    // The keywords or name contain all the search terms
    if (searchTerms.every(term => keywordsSet.has(term)) || searchTerms.every(term => nameTermsSet.has(term))) {
      return 'exactKeyword'
    }
    if (
      searchTerms.some(term => pluginName.includes(term))
      || searchTerms.some(term => pluginKeywords.some(k => k.includes(term)))
      || searchTerms.some(term => pluginDescription.includes(term))
    ) {
      return 'partial'
    }
    return null
  }

  /**
   * Search the npm registry for homebridge plugins
   * @param query
   */
  public async searchNpmRegistry(query: string, installed: InstalledPluginsSource): Promise<HomebridgePlugin[]> {
    if (!installed.loadedPlugins) {
      await installed.getInstalledPlugins()
    }

    const searchTerms = this.extractTerms(query, RE_WHITESPACE) // Separator: whitespace (spaces, tabs and new lines) characters
    const normalizedQuery = searchTerms.length > 0 ? searchTerms.join(' ') : 'homebridge'

    if (
      (normalizedQuery.startsWith('homebridge-') || this.isScopedPlugin(normalizedQuery))
      && !this.isHiddenPlugin(normalizedQuery)
    ) {
      if (
        !installed.loadedPlugins.some(x => x.name === normalizedQuery)
        && Object.keys(this.newScopePlugins).includes(normalizedQuery)
      ) {
        return await this.searchNpmRegistrySingle(`@homebridge-plugins/${normalizedQuery}`, installed)
      }
      return await this.searchNpmRegistrySingle(normalizedQuery, installed)
    }

    // There seems to be a new 64-character limit on the text query (which allows for 15 characters of a query)
    // Get the top 99 plugins now, later we filter down to the top 30
    const q = `${normalizedQuery.substring(0, 15)}+keywords:homebridge-plugin+not:deprecated&size=99`
    let searchResults: INpmSearchResults
    try {
      searchResults = (await firstValueFrom(this.httpService.get(`https://registry.npmjs.org/-/v1/search?text=${q}`))).data
    } catch (e) {
      this.logger.error(`Failed to search the npm registry (see https://homebridge.io/w/JJSz6 for help) as ${e.message}.`)
      throw new InternalServerErrorException(`Failed to search the npm registry as ${e.message}, see logs.`)
    }

    const plugins: HomebridgePlugin[] = searchResults.objects
      .filter(x =>
        (x.package.name.startsWith('homebridge-') || this.isScopedPlugin(x.package.name))
        && !this.isHiddenPlugin(x.package.name),
      )
      .map((pkg) => {
        const isInstalled = installed.loadedPlugins.find(x => x.name === pkg.package.name)

        // See if the plugin is already installed
        if (isInstalled) {
          return {
            ...isInstalled,
            lastUpdated: pkg.package.date,
            keywords: pkg.package.keywords || [],
          }
        }

        // It's not installed; finish building the response
        return {
          name: pkg.package.name,
          displayName: this.pluginNames[pkg.package.name],
          private: false,
          publicPackage: true,
          installedVersion: null,
          latestVersion: pkg.package.version,
          lastUpdated: pkg.package.date,
          description: (pkg.package.description || pkg.package.name).replace(RE_URL_WITH_OPTIONAL_PAREN, '').trim(),
          keywords: pkg.package.keywords || [],
          links: pkg.package.links,
          author: this.pluginAuthors[pkg.package.name] || (pkg.package.publisher ? pkg.package.publisher.username : null),
          verifiedPlugin: this.verifiedPlugins.includes(pkg.package.name),
          verifiedPlusPlugin: this.verifiedPlusPlugins.includes(pkg.package.name),
          supportsMatter: this.supportsMatter(pkg.package.keywords),
          supportsHap: this.supportsHap(pkg.package.keywords),
          icon: this.pluginIcons[pkg.package.name] ? `${this.pluginListUrl}${this.pluginIcons[pkg.package.name]}` : null,
          isHbScoped: pkg.package.name.startsWith('@homebridge-plugins/'),
          newHbScope: this.newScopePlugins[pkg.package.name],
          isUnmaintained: this.unmaintainedPlugins.includes(pkg.package.name),
        }
      })

    // Find scoped plugins from the plugin list that match search terms but weren't returned by npm
    const resultNames = new Set(plugins.map(p => p.name))
    // Each lookup fetches a full packument, so a short term (which matches
    // nearly every name - 'a', 'on') is not used, and only the best few
    // candidates are fetched
    const scopedTerms = searchTerms.filter(term => term.length >= PluginRegistryService.MIN_SCOPED_TERM_LENGTH)
    const scopedCandidates: { name: string, matches: number }[] = []

    if (scopedTerms.length > 0) {
      for (const name of this.scopedPluginNames) {
        if (!resultNames.has(name) && !this.isHiddenPlugin(name)) {
          // Extract the unscoped part after the scope prefix for matching
          const unscopedName = name.substring(name.lastIndexOf('/') + 1).toLowerCase()
          const matches = scopedTerms.filter(term => unscopedName.includes(term)).length
          if (matches > 0) {
            scopedCandidates.push({ name, matches })
          }
        }
      }
    }

    // Stable sort: the names matching the most terms first, list order otherwise
    const scopedLookups: Promise<HomebridgePlugin[]>[] = scopedCandidates
      .sort((a, b) => b.matches - a.matches)
      .slice(0, PluginRegistryService.MAX_SCOPED_LOOKUPS)
      .map(({ name }) => this.searchNpmRegistrySingle(name, installed).catch(() => []))

    if (scopedLookups.length > 0) {
      const scopedResults = await Promise.all(scopedLookups)
      for (const results of scopedResults) {
        for (const plugin of results) {
          if (!resultNames.has(plugin.name)) {
            plugins.push(plugin)
            resultNames.add(plugin.name)
          }
        }
      }
    }

    const matchGroups = {
      exactName: [] as HomebridgePlugin[],
      exactKeyword: [] as HomebridgePlugin[],
      partial: [] as HomebridgePlugin[],
    }

    for (const plugin of plugins) {
      const matchType = this.matchesPlugin(plugin, searchTerms)
      if (matchType) {
        matchGroups[matchType].push(plugin)
      }
    }

    const orderPlugins = (arr: HomebridgePlugin[]) =>
      [...arr].sort((a, b) => {
        const aPlus = a.verifiedPlusPlugin ? 1 : 0
        const bPlus = b.verifiedPlusPlugin ? 1 : 0
        if (aPlus !== bPlus) {
          return bPlus - aPlus
        }
        const aVerified = a.verifiedPlugin ? 1 : 0
        const bVerified = b.verifiedPlugin ? 1 : 0
        if (aVerified !== bVerified) {
          return bVerified - aVerified
        }
        return (b.lastUpdated ?? '').localeCompare(a.lastUpdated ?? '')
      })

    // Separate scoped plugins so they always appear first
    const allResults = [
      ...matchGroups.exactName,
      ...matchGroups.exactKeyword,
      ...matchGroups.partial,
    ]
    const scopedResults = allResults.filter(p => p.isHbScoped)
    const unscopedResults = allResults.filter(p => !p.isHbScoped)

    return [...orderPlugins(scopedResults), ...orderPlugins(unscopedResults)]
      .slice(0, 30)
      .map(plugin => this.fixDisplayName(plugin))
  }

  /**
   * Get a single plugin from the registry using its exact name
   * Used as a fallback if the search queries are not finding the desired plugin
   * @param query
   */
  public async searchNpmRegistrySingle(query: string, installed: InstalledPluginsSource): Promise<HomebridgePlugin[]> {
    try {
      const fromCache = this.npmPluginCache.get<INpmRegistryModule>(`package-${query}`)

      const pkg: INpmRegistryModule = fromCache || (await firstValueFrom((
        this.httpService.get(`https://registry.npmjs.org/${encodeURIComponent(query).replace(RE_ENCODED_AT, '@')}`)),
      )).data

      if (!fromCache) {
        this.npmPluginCache.set(`package-${query}`, pkg, 60)
      }

      if (!pkg.keywords || !pkg.keywords.includes('homebridge-plugin')) {
        return []
      }

      // See if the plugin is already installed
      if (!installed.loadedPlugins) {
        await installed.getInstalledPlugins()
      }
      const isInstalled = installed.loadedPlugins.find(x => x.name === pkg.name)
      if (isInstalled) {
        // A copy: the installed list is cached by reference
        return [{ ...isInstalled, lastUpdated: pkg.time.modified }]
      }

      const plugin: HomebridgePlugin = {
        name: pkg.name,
        private: false,
        description: (pkg.description)
          ? pkg.description.replace(RE_URL, '').trim()
          : pkg.name,
        verifiedPlugin: this.verifiedPlugins.includes(pkg.name),
        verifiedPlusPlugin: this.verifiedPlusPlugins.includes(pkg.name),
        supportsMatter: this.supportsMatter(pkg.keywords),
        supportsHap: this.supportsHap(pkg.keywords),
        icon: this.pluginIcons[pkg.name],
        isHbScoped: pkg.name.startsWith('@homebridge-plugins/'),
        newHbScope: this.newScopePlugins[pkg.name],
        isUnmaintained: this.unmaintainedPlugins.includes(pkg.name),
      } as HomebridgePlugin

      // It's not installed; finish building the response
      plugin.displayName = this.pluginNames[pkg.name]
      plugin.publicPackage = true
      plugin.latestVersion = pkg['dist-tags'] ? pkg['dist-tags'].latest : undefined
      plugin.lastUpdated = pkg.time.modified
      plugin.updateAvailable = false
      plugin.updateTag = null
      plugin.links = {
        npm: `https://www.npmjs.com/package/${plugin.name}`,
        homepage: pkg.homepage,
        bugs: typeof pkg.bugs === 'object' && pkg.bugs?.url ? pkg.bugs.url : null,
      }
      plugin.author = this.pluginAuthors[pkg.name]
        || ((pkg.maintainers && pkg.maintainers.length) ? pkg.maintainers[0].name : null)
      plugin.verifiedPlugin = this.verifiedPlugins.includes(pkg.name)
      plugin.verifiedPlusPlugin = this.verifiedPlusPlugins.includes(pkg.name)
      plugin.supportsMatter = this.supportsMatter(pkg.keywords)
      plugin.supportsHap = this.supportsHap(pkg.keywords)
      plugin.icon = this.pluginIcons[pkg.name]
        ? `${this.pluginListUrl}${this.pluginIcons[pkg.name]}`
        : null
      plugin.isHbScoped = pkg.name.startsWith('@homebridge-plugins/')
      plugin.newHbScope = this.newScopePlugins[pkg.name]
      plugin.isUnmaintained = this.unmaintainedPlugins.includes(pkg.name)

      return [this.fixDisplayName(plugin)]
    } catch (e) {
      if (e.response?.status !== 404) {
        this.logger.error(`Failed to search the npm registry (see https://homebridge.io/w/JJSz6 for help) as ${e.message}.`)
      }
      return []
    }
  }

  /**
   * Return a boolean if the plugin is a @scoped/homebridge plugin
   */
  public isScopedPlugin(name: string): boolean {
    return (name.charAt(0) === '@' && name.split('/').length > 0 && name.split('/')[1].indexOf('homebridge-') === 0)
  }

  /**
   * Check if a plugin is hidden, either by exact name or by scope prefix
   */
  private isHiddenPlugin(name: string): boolean {
    return this.hiddenPlugins.includes(name) || this.hiddenScopes.some(scope => name.startsWith(scope))
  }

  /**
   * Shared method to check for beta version updates
   * Modifies the plugin object in place if a beta update is found
   * @param plugin - The plugin object to check and update
   * @param packageName - The package name to query for versions
   * @param preferBetas - Whether to prefer beta versions for this package
   */
  public async checkForBetaUpdates(
    plugin: HomebridgePlugin,
    packageName: string,
    preferBetas: boolean,
  ): Promise<void> {
    const pluginVersion = parse(plugin.installedVersion)
    const installedTag = pluginVersion.prerelease[0]?.toString()

    // Check for beta updates if:
    // - Currently on a beta/alpha/test version AND current > latest stable
    // - OR preferBetas setting is enabled for this package
    const shouldCheckBetas = (
      installedTag
      && ['alpha', 'beta', 'test'].includes(installedTag)
      && gt(plugin.installedVersion, plugin.latestVersion)
    ) || preferBetas

    if (!shouldCheckBetas) {
      return
    }

    const versions = await this.getAvailablePluginVersions(packageName)
    const targetTag = preferBetas && !installedTag ? 'beta' : installedTag
    const candidate = versions.tags[targetTag]

    // Most packages publish no prerelease tag, so there is nothing to compare
    // against. Returning here keeps the caller's stable result and stops the
    // comparisons below from being handed an undefined version.
    if (!candidate) {
      return
    }

    // Offer the prerelease only when it is the newest thing available. A
    // prerelease sorts below its own release (1.2.4-beta.5 < 1.2.4), so once the
    // stable overtakes the beta line we keep the stable rather than sending a
    // beta user backwards. Without the second check the caller's stable result
    // would also be left in place while the beta preference was ignored, which
    // is how a beta user ended up being offered, and shown release notes for,
    // the stable version.
    const beatsInstalled = gt(candidate, plugin.installedVersion)
    const beatsStable = !plugin.updateAvailable || gt(candidate, plugin.latestVersion)

    if (beatsInstalled && beatsStable) {
      plugin.latestVersion = candidate
      plugin.updateAvailable = true
      plugin.updateEngines = versions.versions?.[plugin.latestVersion]?.engines || null
      plugin.updateTag = targetTag
    }
  }

  /**
   * Convert the package.json into a HomebridgePlugin
   * @param pkgJson
   * @param installPath
   */
  public async parsePackageJson(pkgJson: IPackageJson, installPath: string): Promise<HomebridgePlugin> {
    const plugin: HomebridgePlugin = {
      name: pkgJson.name,
      displayName: pkgJson.displayName || this.pluginNames[pkgJson.name],
      private: pkgJson.private || false,
      description: (pkgJson.description)
        ? pkgJson.description.replace(RE_URL, '').trim()
        : pkgJson.name,
      verifiedPlugin: this.verifiedPlugins.includes(pkgJson.name),
      verifiedPlusPlugin: this.verifiedPlusPlugins.includes(pkgJson.name),
      supportsMatter: this.supportsMatter(pkgJson.keywords),
      supportsHap: this.supportsHap(pkgJson.keywords),
      icon: this.pluginIcons[pkgJson.name]
        ? `${this.pluginListUrl}${this.pluginIcons[pkgJson.name]}`
        : null,
      isHbScoped: pkgJson.name.startsWith('@homebridge-plugins/'),
      newHbScope: this.newScopePlugins[pkgJson.name],
      isUnmaintained: this.unmaintainedPlugins.includes(pkgJson.name),
      installedVersion: installPath ? (pkgJson.version || '0.0.1') : null,
      globalInstall: (installPath !== this.configService.customPluginPath),
      settingsSchema: await pathExists(resolve(installPath, pkgJson.name, 'config.schema.json')),
      engines: pkgJson.engines,
      installPath,
    }

    // Only verified plugins can show donation links
    plugin.funding = (plugin.verifiedPlugin || plugin.verifiedPlusPlugin) ? pkgJson.funding : undefined

    // Add directories for i18n schema support
    plugin.directories = pkgJson.directories

    // If the plugin is private, do not attempt to query npm
    if (pkgJson.private) {
      plugin.publicPackage = false
      plugin.latestVersion = null
      plugin.updateAvailable = false
      plugin.links = {}
      return plugin
    }

    return this.getPluginFromNpm(plugin)
  }

  /**
   * Accepts a HomebridgePlugin and adds data from npm
   * @param plugin
   * @param skipBetaCheck - Skip beta checking (used when beta check is done separately)
   */
  public async getPluginFromNpm(plugin: HomebridgePlugin, skipBetaCheck = false): Promise<HomebridgePlugin> {
    try {
      // Attempt to load from cache
      const fromCache = this.npmPluginCache.get(plugin.name)
      plugin.updateAvailable = false
      plugin.updateTag = null

      // Restore from cache, or load from npm
      const pkg: IPackageJson = fromCache || (
        await firstValueFrom(this.httpService.get(`https://registry.npmjs.org/${encodeURIComponent(plugin.name).replace(RE_ENCODED_AT, '@')}/latest`))
      ).data

      plugin.latestVersion = pkg.version
      plugin.updateAvailable = gt(pkg.version, plugin.installedVersion)
      plugin.updateEngines = plugin.updateAvailable ? pkg.engines : null

      // Check for beta updates using plugin-specific preference (unless skipped)
      if (!skipBetaCheck) {
        const preferBetas = this.configService.ui.plugins?.showBetasFor?.includes(plugin.name) || false

        await this.checkForBetaUpdates(
          plugin,
          plugin.name,
          preferBetas,
        )
      }

      // Store in cache if it was not there already
      if (!fromCache) {
        this.npmPluginCache.set(plugin.name, pkg)
      }

      plugin.publicPackage = true
      plugin.links = {
        npm: `https://www.npmjs.com/package/${plugin.name}`,
        homepage: pkg.homepage,
        bugs: typeof pkg.bugs === 'object' && pkg.bugs?.url ? pkg.bugs.url : null,
      }
      plugin.author = this.pluginAuthors[pkg.name]
        || ((pkg.maintainers && pkg.maintainers.length) ? pkg.maintainers[0].name : null)
    } catch (e) {
      if (e.response?.status !== 404) {
        this.logger.log(`[${plugin.name}] failed to check registry.npmjs.org for updates (see https://homebridge.io/w/JJSz6 for help) as ${e.message}.`)
      }
      plugin.publicPackage = false
      plugin.latestVersion = null
      plugin.updateAvailable = false
      plugin.updateTag = null
      plugin.links = {}
    }
    return plugin
  }

  /**
   * Returns the "latest" version for the provided module
   * @param npmModuleName
   */
  public async getNpmModuleLatestVersion(npmModuleName: string): Promise<string> {
    try {
      const response = await firstValueFrom(this.httpService.get<IPackageJson>(`https://registry.npmjs.org/${npmModuleName}/latest`))
      return response.data.version
    } catch (e) {
      return 'latest'
    }
  }

  /**
   * Loads the list of plugins from GitHub
   * This is verified plugins, verified plus plugins, plugin icons and hidden plugins
   */
  private async loadPluginList() {
    clearTimeout(this.pluginListRetryTimeout)
    try {
      const pluginList: PluginListData = (
        await firstValueFrom(this.httpService.get(this.pluginListFile, {
          httpsAgent: null,
        }))
      )
      const pluginListData = pluginList.data

      // Populate locals first, then swap the service fields over in one
      // synchronous block. Clearing the fields up front and pushing into
      // them in-place would let any concurrent reader observe the cache
      // mid-rebuild (the windows are narrow but real on reload paths
      // that fan out to several callers).
      const verifiedPlugins: string[] = []
      const verifiedPlusPlugins: string[] = []
      const pluginIcons: Record<string, string> = {}
      const hiddenPlugins: string[] = []
      const hiddenScopes: string[] = []
      const unmaintainedPlugins: string[] = []
      const pluginAuthors: Record<string, string> = {}
      const pluginNames: Record<string, string> = {}
      const pluginChangelogs: Record<string, string> = {}
      const newScopePlugins: Record<string, PluginListNewScopeItem> = {}
      const scopedPluginNames: string[] = []

      Object.keys(pluginListData).forEach((key) => {
        if (key.startsWith('@homebridge-plugins/')) {
          scopedPluginNames.push(key)
        }
        const plugin: PluginListItem = pluginListData[key]
        if (plugin.i) {
          pluginIcons[key] = `icons/${plugin.i}.png`
        }
        if (plugin.h) {
          if (key.endsWith('/')) {
            hiddenScopes.push(key)
          } else {
            hiddenPlugins.push(key)
          }
        }
        if (plugin.u) {
          unmaintainedPlugins.push(key)
        }
        if (plugin.a) {
          pluginAuthors[key] = plugin.a
        }
        if (plugin.n) {
          pluginNames[key] = plugin.n
        }
        if (plugin.s) {
          newScopePlugins[key] = plugin.s
        }
        if (plugin.v) {
          verifiedPlugins.push(key)
        }
        if (plugin.p) {
          verifiedPlusPlugins.push(key)
        }
        if (plugin.c) {
          pluginChangelogs[key] = plugin.c
        }
      })

      this.verifiedPlugins = verifiedPlugins
      this.verifiedPlusPlugins = verifiedPlusPlugins
      this.pluginIcons = pluginIcons
      this.hiddenPlugins = hiddenPlugins
      this.hiddenScopes = hiddenScopes
      this.unmaintainedPlugins = unmaintainedPlugins
      this.pluginAuthors = pluginAuthors
      this.pluginNames = pluginNames
      this.pluginChangelogs = pluginChangelogs
      this.newScopePlugins = newScopePlugins
      this.scopedPluginNames = scopedPluginNames
    } catch (e) {
      // Try again in 60 seconds
      this.pluginListRetryTimeout = setTimeout(() => this.loadPluginList(), 60000)
      this.logger.debug(`Could not obtain plugin list from plugins repo as ${e.message}.`)
    }
  }

  /**
   * Plugin list lookups for packages built outside this service
   */
  public getListedName(name: string): string | undefined {
    return this.pluginNames[name]
  }

  public isVerifiedPlugin(name: string): boolean {
    return this.verifiedPlugins.includes(name)
  }

  public isVerifiedPlusPlugin(name: string): boolean {
    return this.verifiedPlusPlugins.includes(name)
  }

  public isUnmaintainedPlugin(name: string): boolean {
    return this.unmaintainedPlugins.includes(name)
  }

  public getNewScope(name: string): PluginListNewScopeItem | undefined {
    return this.newScopePlugins[name]
  }

  public getPluginIconUrl(name: string): string | null {
    return this.pluginIcons[name]
      ? `${this.pluginListUrl}${this.pluginIcons[name]}`
      : null
  }

  public getPluginChangelogPath(name: string): string | undefined {
    return this.pluginChangelogs[name]
  }
}
