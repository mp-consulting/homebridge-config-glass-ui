import { t } from '@/core/ui/i18n'

/**
 * The search index of the settings page, shared by every section: which rows
 * belong to which section, the text each one is matched on, and the filter
 * itself. Kept apart from the sections so that a row added to one has a single
 * place to be registered.
 */

export type SettingsSection = 'general' | 'display' | 'startup' | 'network' | 'hap' | 'matter' | 'terminal' | 'security' | 'assistant' | 'notifications' | 'instances' | 'cache' | 'reset'

export interface SectionNavEntry {
  key: SettingsSection
  icon: string
  title: string
}

// Section index shown beside the settings (a row of chips on narrow screens).
// Order matches the page; the two protocol sections only exist with matter support.
export const allSections: SectionNavEntry[] = [
  { key: 'general', icon: 'fas fa-sliders', title: 'settings.general.title_general' },
  { key: 'display', icon: 'fas fa-palette', title: 'settings.general.title_display' },
  { key: 'startup', icon: 'fas fa-rocket', title: 'settings.title_startup_options' },
  { key: 'network', icon: 'fas fa-network-wired', title: 'settings.network.title_network' },
  { key: 'hap', icon: 'fas fa-house-signal', title: 'settings.hap.title' },
  { key: 'matter', icon: 'fas fa-circle-nodes', title: 'settings.matter.title' },
  { key: 'terminal', icon: 'fas fa-terminal', title: 'settings.network.title_terminal' },
  { key: 'security', icon: 'fas fa-shield-halved', title: 'settings.network.title_security' },
  { key: 'assistant', icon: 'fas fa-wand-magic-sparkles', title: 'ai.settings.title' },
  { key: 'notifications', icon: 'fas fa-bell', title: 'settings.notifications.title' },
  { key: 'instances', icon: 'fas fa-server', title: 'instances.title' },
  { key: 'cache', icon: 'fas fa-lightbulb', title: 'menu.label_accessories' },
  { key: 'reset', icon: 'fas fa-rotate-left', title: 'reset.bridges.title' },
]

// Define which items belong to which section
export const sectionItems: Record<string, string[]> = {
  general: [
    'setting-name',
    'setting-backup',
    'setting-restore',
    'setting-users',
  ],
  display: [
    'setting-lang',
    'setting-theme',
    'setting-lighting',
    'setting-glass',
    'setting-menu',
    'setting-temp',
    'setting-terminal-font-size',
    'setting-terminal-font-weight',
    'setting-terminal-lighting-mode',
    'setting-wallpaper',
  ],
  startup: [
    'setting-debug',
    'setting-keep',
    'setting-insecure',
    'setting-security-control',
    'setting-scheduled-restart',
    'setting-metrics-startup',
    'setting-package-path',
    'setting-linux-shutdown',
    'setting-linux-restart',
    'setting-linux-temp',
    'setting-env-debug-manual',
    'setting-env-node',
    'setting-docker-startup',
  ],
  network: [
    'setting-interfaces',
    'setting-mdns',
    'setting-mdns-advertise',
    'setting-port-hb',
    'setting-port-range',
    'setting-network-host',
    'setting-network-proxy',
    'setting-ui-port-network',
    'setting-port-overview',
  ],
  hap: [
    'setting-hap-enabled',
    'setting-hap-disable-identifying-material',
  ],
  matter: [
    'setting-matter-enabled',
    'setting-matter-port',
    'setting-matter-port-range',
    'setting-matter-disable-ipv4',
  ],
  terminal: [
    'setting-terminal-log-max',
    'setting-terminal-log-truncate',
    'setting-terminal-persistence',
    'setting-terminal-warning',
    'setting-terminal-buffer',
  ],
  security: [
    'setting-security-auth',
    'setting-session-inactivity',
    'setting-security-session',
    'setting-security-https',
  ],
  assistant: [
    'setting-ai-enabled',
    'setting-ai-provider',
    'setting-ai-model',
    'setting-ai-key',
    'setting-ai-base-url',
    'setting-ai-max-tokens',
    'setting-ai-test',
    'setting-ai-usage',
  ],
  notifications: [
    'setting-notifications-webhook',
    'setting-notifications-ntfy',
    'setting-notifications-pushover',
    'setting-notifications-telegram',
    'setting-notifications-events',
  ],
  instances: [
    'setting-instances',
  ],
  cache: [
    'setting-accessory-debug',
    'setting-accessory-history',
    'setting-reset-accessory-ind',
    'setting-reset-bridge-accessories',
    'setting-reset-accessory-all',
  ],
  reset: [
    'setting-reset-bridge-ind',
    'setting-reset-bridge-all',
  ],
}

/** The text a whole section is matched on: its title, and its description where it has one. */
export function getSectionContent(): Record<string, string> {
  return {
    general: t('settings.general.title_general'),
    display: t('settings.general.title_display'),
    startup: t('settings.title_startup_options'),
    network: t('settings.network.title_network'),
    hap: `${t('settings.hap.title')} ${t('settings.hap.desc')}`,
    matter: `${t('settings.matter.title')} ${t('settings.matter.desc')}`,
    terminal: t('settings.network.title_terminal'),
    security: t('settings.network.title_security'),
    assistant: `${t('ai.settings.title')} ${t('ai.settings.desc')}`,
    notifications: `${t('settings.notifications.title')} ${t('settings.notifications.desc')}`,
    instances: `${t('instances.title')} ${t('instances.desc')}`,
    cache: `${t('menu.label_accessories')} ${t('settings.cache.desc')}`,
    reset: `${t('reset.bridges.title')} ${t('reset.bridges.desc')}`,
  }
}

/** Each setting row's translated text (must match `sectionItems`). */
export function getItemsContent(): Record<string, string> {
  return {
    // General section
    'setting-name': t('settings.name'),
    'setting-backup': t('backup.title_backup'),
    'setting-restore': t('config.restore.title'),
    'setting-users': t('menu.tooltip_user_accounts'),

    // Display section
    'setting-lang': t('settings.display.lang'),
    'setting-theme': t('settings.display.theme'),
    'setting-lighting': t('settings.display.lighting_mode'),
    'setting-glass': t('settings.display.glass_mode'),
    'setting-menu': t('settings.display.menu_mode'),
    'setting-temp': t('settings.display.temp_units'),
    'setting-terminal-font-size': t('settings.terminal.theme'),
    'setting-terminal-font-weight': t('settings.terminal.theme'),
    'setting-terminal-lighting-mode': t('settings.terminal.theme'),
    'setting-wallpaper': t('settings.display.wallpaper'),

    // Startup section
    'setting-debug': t('settings.startup.debug'),
    'setting-keep': t('settings.startup.keep_accessories'),
    'setting-insecure': t('settings.startup.insecure'),
    'setting-security-control': t('settings.security.ui_control'),
    'setting-scheduled-restart': t('settings.startup.scheduled_restart'),
    'setting-metrics-startup': t('settings.startup.metrics'),
    'setting-package-path': t('settings.network.hb_package'),
    'setting-linux-shutdown': t('settings.linux.shutdown'),
    'setting-linux-restart': t('settings.linux.restart'),
    'setting-linux-temp': t('settings.linux.temp'),
    'setting-env-debug-manual': 'DEBUG',
    'setting-env-node': 'NODE OPTIONS',
    'setting-docker-startup': t('menu.docker.startup_script'),

    // Network section
    'setting-interfaces': t('settings.network.title_network_interfaces'),
    'setting-mdns': t('settings.mdns_advertiser'),
    'setting-mdns-advertise': t('settings.network.mdns_advertise'),
    'setting-port-hb': t('settings.network.port_hb'),
    'setting-port-range': t('settings.network.port_range'),
    'setting-network-host': t('settings.network.host'),
    'setting-network-proxy': t('settings.network.proxy'),
    'setting-ui-port-network': t('settings.network.port_ui'),
    'setting-port-overview': t('settings.ports.title'),

    // HAP section
    'setting-hap-enabled': `${t('common.labels.enabled')} ${t('settings.hap.enabled_desc')}`,
    'setting-hap-disable-identifying-material': `${t('settings.hap.disable_identifying_material')} ${t('settings.hap.disable_identifying_material_desc')}`,

    // Matter section
    'setting-matter-enabled': `${t('common.labels.enabled')} ${t('settings.matter.enabled_desc')}`,
    'setting-matter-port': `${t('settings.matter.port')} ${t('settings.matter.port_desc')}`,
    'setting-matter-port-range': `${t('settings.network.port_range')} ${t('settings.matter.port_range_desc')}`,
    'setting-matter-disable-ipv4': `${t('settings.matter.disable_ipv4')} ${t('settings.matter.disable_ipv4_desc')}`,

    // Terminal section
    'setting-terminal-log-max': t('settings.terminal.log_max'),
    'setting-terminal-log-truncate': t('settings.terminal.log_truncate'),
    'setting-terminal-persistence': t('settings.terminal.persistence'),
    'setting-terminal-warning': t('settings.terminal.warning'),
    'setting-terminal-buffer': t('settings.terminal.buffer_size'),

    // Security section
    'setting-security-auth': t('settings.security.auth'),
    'setting-session-inactivity': t('settings.startup.session_inactivity_based'),
    'setting-security-session': t('settings.startup.session'),
    'setting-security-https': t('settings.security.https_enable'),

    // Assistant section
    'setting-ai-enabled': t('ai.settings.enabled'),
    'setting-ai-provider': t('ai.settings.provider'),
    'setting-ai-model': t('ai.settings.model'),
    'setting-ai-key': t('ai.settings.api_key'),
    'setting-ai-base-url': t('ai.settings.base_url'),
    'setting-ai-max-tokens': t('ai.settings.max_tokens'),
    'setting-ai-test': t('ai.settings.test'),
    'setting-ai-usage': t('ai.settings.usage'),
    // Notifications section
    'setting-notifications-webhook': `${t('settings.notifications.webhook')} webhook`,
    'setting-notifications-ntfy': 'ntfy',
    'setting-notifications-pushover': 'Pushover',
    'setting-notifications-telegram': 'Telegram',
    'setting-notifications-events': t('settings.notifications.events'),

    // Instances section
    'setting-instances': t('instances.title'),

    // Cache section
    'setting-accessory-debug': t('settings.accessory.debug'),
    'setting-accessory-history': `${t('settings.accessory.history')} ${t('settings.accessory.history_desc')}`,
    'setting-reset-accessory-ind': t('reset.accessory_ind.title'),
    'setting-reset-bridge-accessories': t('reset.bridge_accessories.title'),
    'setting-reset-accessory-all': t('reset.accessory_all.title'),

    // Reset section
    'setting-reset-bridge-ind': t('reset.bridge_ind.title'),
    'setting-reset-bridge-all': t('reset.bridge_all.title'),
  }
}

/** What decides whether a row is rendered at all, regardless of the search. */
export interface AvailabilityState {
  platform: string
  runningOnRaspberryPi: boolean
  runningInDocker: boolean
  matterEnabled: boolean | null
  isMatterDisableIpv4Enabled: boolean
  isHapDisableIdentifyingMaterialEnabled: boolean
  hbLogSize: number | null
  enableTerminalAccess: boolean
  uiTerminalPersistence: boolean | null
  uiAuth: boolean | null
}

/**
 * Item ids that are not currently rendered due to non-search template
 * conditions (platform checks, dependent toggles, etc.).
 * @param state - the conditions the template checks
 */
export function getUnavailableItems(state: AvailabilityState): string[] {
  const unavailable: string[] = []

  if (state.platform !== 'linux') {
    unavailable.push('setting-linux-shutdown', 'setting-linux-restart', 'setting-linux-temp')
  } else if (!state.runningOnRaspberryPi) {
    unavailable.push('setting-linux-temp')
  }

  if (!state.runningInDocker) {
    unavailable.push('setting-docker-startup')
  }

  if (!state.matterEnabled) {
    unavailable.push('setting-matter-port', 'setting-matter-port-range', 'setting-matter-disable-ipv4')
  }

  if (!state.isMatterDisableIpv4Enabled) {
    unavailable.push('setting-matter-disable-ipv4')
  }

  if (!state.isHapDisableIdentifyingMaterialEnabled) {
    unavailable.push('setting-hap-disable-identifying-material')
  }

  if (!(state.hbLogSize! > 0)) {
    unavailable.push('setting-terminal-log-truncate')
  }

  if (!state.enableTerminalAccess) {
    // The startup script runs as root in the container, so the server only edits it with terminal access
    unavailable.push('setting-terminal-persistence', 'setting-terminal-warning', 'setting-terminal-buffer', 'setting-docker-startup')
  } else if (state.uiTerminalPersistence) {
    unavailable.push('setting-terminal-warning')
  } else {
    unavailable.push('setting-terminal-buffer')
  }

  if (!state.uiAuth) {
    unavailable.push('setting-session-inactivity', 'setting-security-session')
  }

  return unavailable
}

/**
 * The rows a query hides. A section whose title or description matches keeps
 * every row; otherwise each row is matched on its own text. Rows the template
 * is not rendering anyway count as hidden too, so a section left with nothing
 * but those disappears instead of showing an empty heading.
 * @param searchQuery - what the user typed
 * @param unavailable - the rows not rendered, from {@link getUnavailableItems}
 */
export function filterSettings(searchQuery: string, unavailable: string[]): Record<string, boolean> {
  if (!searchQuery) {
    // If no search query, show everything
    return {}
  }

  const query = searchQuery.toLowerCase()
  const itemsContent = getItemsContent()
  const sectionContent = getSectionContent()

  // Determine which sections match by title or description
  const matchedSections = new Set<string>()
  for (const [sectionName, searchableText] of Object.entries(sectionContent)) {
    if (searchableText.toLowerCase().includes(query)) {
      matchedSections.add(sectionName)
    }
  }

  // Check each item and hide those that don't match
  const hiddenItems: Record<string, boolean> = {}
  Object.entries(itemsContent).forEach(([itemId, searchableText]) => {
    // If this item belongs to a section that matched, keep it visible
    const belongsToMatchedSection = Object.entries(sectionItems).some(
      ([sectionName, items]) => matchedSections.has(sectionName) && items.includes(itemId),
    )
    if (belongsToMatchedSection) {
      return
    }

    const matches = searchableText && searchableText.toLowerCase().includes(query)
    if (!matches) {
      hiddenItems[itemId] = true
    }
  })
  // Also hide items whose non-search rendering conditions are false,
  // so isSectionVisible correctly excludes items not in the DOM.
  for (const itemId of unavailable) {
    hiddenItems[itemId] = true
  }

  return hiddenItems
}

/**
 * Whether a section has anything left to show for the query.
 * @param sectionName - the section
 * @param searchQuery - what the user typed
 * @param hiddenItems - from {@link filterSettings}
 */
export function isSectionVisible(sectionName: string, searchQuery: string, hiddenItems: Record<string, boolean>): boolean {
  // If no search query, all sections are visible
  if (!searchQuery) {
    return true
  }

  // Get the items for this section
  const items = sectionItems[sectionName]
  if (!items) {
    return true // If section not defined, show it by default
  }

  // Check if at least one item in the section is visible
  return items.some(itemId => !hiddenItems[itemId])
}
