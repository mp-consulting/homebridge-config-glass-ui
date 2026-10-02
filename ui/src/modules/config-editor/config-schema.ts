import type { TFunction } from 'i18next'

import { createChildBridgeSchema } from '@/core/helpers/child-bridges-schema.helper'
import { createHapSchema } from '@/core/helpers/hap-schema.helper'
import { createMatterSchema } from '@/core/helpers/matter-schema.helper'

/** The id the schema is registered under with Monaco's JSON validator. */
export const CONFIG_SCHEMA_URI = 'http://homebridge/config.json'

/** The uri of the main editor's model, which the schema's `fileMatch` points at. */
export const CONFIG_MODEL_URI = 'a://homebridge/config.json'

/** The feature flags that change the shape of the schema. */
export interface ConfigSchemaFlags {
  isDebugModeEnabled: boolean
  isMatterSupported: boolean
  isProtocolExternalsOnlyEnabled: boolean
  isMatterDisableIpv4Enabled: boolean
  isHapDisableIdentifyingMaterialEnabled: boolean
}

/**
 * The JSON schema the config editor validates config.json against: the
 * bridge, mdns, ports, platforms (with the UI's own `config` platform spelled
 * out), accessories and plugin lists.
 * @param t - translates the titles and descriptions
 * @param flags - the feature flags of the running Homebridge
 */
export function createConfigSchema(t: TFunction, flags: ConfigSchemaFlags) {
  const childBridgeSchema = createChildBridgeSchema(t, {
    isDebugModeEnabled: flags.isDebugModeEnabled,
    isMatterSupported: flags.isMatterSupported,
    isProtocolExternalsOnlyEnabled: flags.isProtocolExternalsOnlyEnabled,
    isMatterDisableIpv4Enabled: flags.isMatterDisableIpv4Enabled,
    isHapDisableIdentifyingMaterialEnabled: flags.isHapDisableIdentifyingMaterialEnabled,
  })

  return {
    type: 'object',
    additionalProperties: false,
    required: ['bridge'],
    properties: {
      bridge: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'username', 'port', 'pin'],
        properties: {
          name: {
            type: 'string',
            title: t('settings.name'),
            description: 'The Homebridge instance name.\n'
              + 'This should be unique if you are running multiple instances of Homebridge.',
            default: 'Homebridge',
          },
          username: {
            type: 'string',
            title: t('users.label_username'),
            description: 'Homebridge username must be 6 pairs of colon-separated hexadecimal characters (A-F 0-9).\n'
              + 'You should change this pin if you need to re-pair your instance with HomeKit.\n'
              + 'Example: 0E:89:49:64:91:86.',
            default: '0E:89:49:64:91:86',
            pattern: '^([A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$',
          },
          port: {
            type: 'number',
            title: t('settings.network.port_hb'),
            description: 'The port Homebridge listens on.\n'
              + 'If running more than one instance of Homebridge on the same server make sure each instance is given a unique port.',
            default: 51173,
            minimum: 1025,
            maximum: 65534,
          },
          pin: {
            type: 'string',
            description: 'The Homebridge instance pin.\n'
              + 'This is used when pairing Homebridge to HomeKit.\n'
              + 'Example: 630-27-655.',
            default: '630-27-655',
            pattern: '^([0-9]{3}-[0-9]{2}-[0-9]{3})$',
          },
          manufacturer: {
            type: 'string',
            title: t('child_bridge.config.manufacturer'),
            description: 'The bridge manufacturer to be displayed in HomeKit.',
          },
          firmwareRevision: {
            type: 'string',
            title: t('child_bridge.config.firmware'),
            description: 'The bridge firmware version to be displayed in HomeKit.',
          },
          model: {
            type: 'string',
            title: t('child_bridge.config.model'),
            description: 'The bridge model to be displayed in HomeKit.',
          },
          advertiser: {
            type: 'string',
            title: t('settings.mdns_advertiser'),
            description: t('settings.mdns_advertiser_help'),
            oneOf: [
              {
                title: 'Avahi',
                enum: ['avahi'],
              },
              {
                title: 'Bonjour HAP',
                enum: ['bonjour-hap'],
              },
              {
                title: 'Ciao',
                enum: ['ciao'],
              },
              {
                title: 'Resolved',
                enum: ['resolved'],
              },
            ],
          },
          bind: {
            title: t('settings.network.title_network_interfaces'),
            description: 'A string or an array of strings with the name(s) of the network interface(s) Homebridge should bind to.\n'
              + 'Requires Homebridge v1.3 or later.',
            type: ['string', 'array'],
            items: {
              type: 'string',
              description: t('status.widget.network.network_interface'),
            },
          },
          hap: createHapSchema(t, flags.isProtocolExternalsOnlyEnabled, 'main', flags.isHapDisableIdentifyingMaterialEnabled),
          ...flags.isMatterSupported
            ? { matter: createMatterSchema(t, flags.isProtocolExternalsOnlyEnabled, 'main', flags.isMatterDisableIpv4Enabled) }
            : {},
        },
        default: { name: 'Homebridge', username: '0E:89:49:64:91:86', port: 51173, pin: '6302-7655' },
      },
      mdns: {
        type: 'object',
        additionalProperties: false,
        properties: {
          interface: {
            type: 'string',
            title: t('status.widget.network.network_interface'),
            description: 'The interface or IP address of the interface you want Homebridge to listen on.\n'
              + 'This is useful if your server has multiple interfaces.\n'
              + 'Deprecated as of Homebridge v1.3.0 - use bridge.bind instead.',
          },
          legacyAdvertiser: {
            type: 'boolean',
            title: 'Legacy mDNS Advertiser',
            description: 'Set to false to use the new mdns library, ciao.',
          },
        },
        default: { legacyAdvertiser: false },
      },
      ports: {
        type: 'object',
        additionalProperties: false,
        title: 'Port Range',
        description: 'The range of ports that should be used for external accessories like cameras and TVs.',
        required: ['start', 'end'],
        properties: {
          start: {
            type: 'number',
            default: 52100,
            minimum: 1025,
            maximum: 65534,
            title: t('settings.network.port_range'),
            description: t('settings.network.port_range_desc'),
          },
          end: {
            type: 'number',
            default: 52150,
            minimum: 1025,
            maximum: 65534,
            title: t('settings.network.port_end'),
            description: t('settings.network.port_end_desc'),
          },
        },
        default: {
          start: 52100,
          end: 52150,
        },
      },
      platforms: {
        type: 'array',
        title: 'Platforms',
        description: 'Any plugin that exposes a platform should have its config entered in this array.\n'
          + 'Separate each plugin config block using a comma.',
        items: {
          type: 'object',
          required: ['platform'],
          anyOf: [
            {
              type: 'object',
              required: ['platform'],
              title: t('plugins.button_settings'),
              properties: {
                platform: {
                  type: 'string',
                  title: 'Platform Name',
                  description: 'This is used by Homebridge to identify which plugin this platform belongs to.',
                  not: { enum: ['config'] },
                },
                name: {
                  type: 'string',
                  title: t('accessories.name'),
                  description: 'The name of the platform.',
                },
                _bridge: childBridgeSchema,
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                platform: {
                  type: 'string',
                  title: 'Platform Name',
                  description: 'Homebridge Glass UI platform name must be set to "config".\n'
                    + 'Do not change!',
                  const: 'config',
                },
                name: {
                  title: t('accessories.name'),
                  type: 'string',
                  default: 'Homebridge Glass UI',
                  minLength: 1,
                  description: 'The name of the Homebridge instance.',
                },
                port: {
                  title: t('settings.network.port_ui'),
                  type: 'integer',
                  default: 8080,
                  minimum: 1025,
                  maximum: 65535,
                  description: t('settings.network.port_ui_desc'),
                },
                auth: {
                  type: 'string',
                  default: 'form',
                  title: t('settings.security.auth'),
                  description: t('settings.security.auth_desc'),
                  oneOf: [
                    {
                      title: 'Require Authentication',
                      enum: ['form'],
                    },
                    {
                      title: 'None',
                      enum: ['none'],
                    },
                  ],
                },
                theme: {
                  title: t('settings.display.theme'),
                  description: 'The theme used for the UI.',
                  type: 'string',
                  default: 'orange',
                  oneOf: [
                    { title: t('settings.display.orange'), enum: ['orange'] },
                    { title: t('settings.display.red'), enum: ['red'] },
                    { title: t('settings.display.pink'), enum: ['pink'] },
                    { title: t('settings.display.purple'), enum: ['purple'] },
                    { title: t('settings.display.deep_purple'), enum: ['deep-purple'] },
                    { title: t('settings.display.indigo'), enum: ['indigo'] },
                    { title: t('settings.display.blue'), enum: ['blue'] },
                    { title: t('settings.display.bluegrey'), enum: ['blue-grey'] },
                    { title: t('settings.display.cyan'), enum: ['cyan'] },
                    { title: t('settings.display.green'), enum: ['green'] },
                    { title: t('settings.display.teal'), enum: ['teal'] },
                    { title: t('settings.display.grey'), enum: ['grey'] },
                    { title: t('settings.display.brown'), enum: ['brown'] },
                  ],
                },
                lightingMode: {
                  title: t('settings.display.lighting_mode'),
                  description: 'The lighting mode used for the UI.',
                  type: 'string',
                  default: 'auto',
                  oneOf: [
                    { title: t('accessories.control.auto'), enum: ['auto'] },
                    { title: t('settings.display.light'), enum: ['light'] },
                    { title: t('settings.display.dark'), enum: ['dark'] },
                  ],
                },
                glassMode: {
                  title: t('settings.display.glass_mode'),
                  description: 'Show the UI with translucent glass surfaces.',
                  type: 'boolean',
                  default: true,
                },
                menuMode: {
                  title: t('settings.display.menu_mode'),
                  description: 'Modes for the UI side menu.',
                  type: 'string',
                  default: 'default',
                  oneOf: [
                    { title: t('settings.display.menu_default'), enum: ['default'] },
                    { title: t('settings.display.menu_freeze'), enum: ['freeze'] },
                  ],
                },
                temp: {
                  title: t('settings.linux.temp'),
                  type: 'string',
                  description: t('settings.linux.temp_desc'),
                },
                tempUnits: {
                  title: t('settings.display.temp_units'),
                  description: 'The units used to display the temperature.',
                  type: 'string',
                  default: 'c',
                  oneOf: [
                    { title: t('settings.display.temp_units.c'), enum: ['c'] },
                    { title: t('settings.display.temp_units.f'), enum: ['f'] },
                  ],
                },
                lang: {
                  title: t('settings.display.lang'),
                  type: 'string',
                  default: 'auto',
                  description: 'The language used for the UI.',
                  oneOf: [
                    { title: t('form.select.auto'), enum: ['auto'] },
                    { title: 'Bulgarian (bg)', enum: ['bg'] },
                    { title: 'Catalan (ca)', enum: ['ca'] },
                    { title: 'Chinese - Simplified (zh-CN)', enum: ['zh-CN'] },
                    { title: 'Chinese - Traditional (zh-TW)', enum: ['zh-TW'] },
                    { title: 'Czech (cs)', enum: ['cs'] },
                    { title: 'Dutch (nl)', enum: ['nl'] },
                    { title: 'English (en)', enum: ['en'] },
                    { title: 'Finnish (fi)', enum: ['fi'] },
                    { title: 'French (fr)', enum: ['fr'] },
                    { title: 'German (de)', enum: ['de'] },
                    { title: 'Hebrew (he)', enum: ['he'] },
                    { title: 'Hungarian (hu)', enum: ['hu'] },
                    { title: 'Indonesian (id)', enum: ['id'] },
                    { title: 'Italian (it)', enum: ['it'] },
                    { title: 'Japanese (ja)', enum: ['ja'] },
                    { title: 'Korean (ko)', enum: ['ko'] },
                    { title: 'Macedonian (mk)', enum: ['mk'] },
                    { title: 'Norwegian (no)', enum: ['no'] },
                    { title: 'Polish (pl)', enum: ['pl'] },
                    { title: 'Portuguese (Brazil)', enum: ['pt-BR'] },
                    { title: 'Portuguese (Portugal)', enum: ['pt'] },
                    { title: 'Russian (ru)', enum: ['ru'] },
                    { title: 'Slovenian (sl)', enum: ['sl'] },
                    { title: 'Spanish (es)', enum: ['es'] },
                    { title: 'Swedish (sv)', enum: ['sv'] },
                    { title: 'Thai (th)', enum: ['th'] },
                    { title: 'Turkish (tr)', enum: ['tr'] },
                    { title: 'Ukrainian (uk)', enum: ['uk'] },
                    { title: 'Vietnamese (vi)', enum: ['vi'] },
                  ],
                },
                wallpaper: {
                  title: t('settings.display.wallpaper'),
                  description: 'The full path to the .jpg file.',
                  type: 'string',
                },
                homebridgePackagePath: {
                  title: t('settings.network.hb_package'),
                  type: 'string',
                  description: t('settings.network.hb_package_desc'),
                },
                host: {
                  type: 'string',
                  pattern: '^[^{}/ :\\\\]+(?::\\d+)?$',
                  title: t('settings.network.host'),
                  description: t('settings.network.host_desc'),
                },
                sessionTimeoutInactivityBased: {
                  type: 'boolean',
                  title: t('settings.startup.session_inactivity_based'),
                  description: t('settings.startup.session_inactivity_based_desc'),
                },
                sessionTimeout: {
                  type: 'integer',
                  minimum: 600,
                  maximum: 86400000,
                  title: t('settings.startup.session'),
                  description: t('settings.startup.session_desc'),
                },
                log: {
                  type: 'object',
                  additionalProperties: false,
                  title: 'Log Settings',
                  description: 'The log settings for the Homebridge Glass UI.',
                  properties: {
                    maxSize: {
                      type: 'integer',
                      title: t('settings.terminal.log_max'),
                      description: t('settings.terminal.log_max_desc'),
                      minimum: -1,
                    },
                    truncateSize: {
                      type: 'integer',
                      title: t('settings.terminal.log_truncate'),
                      description: t('settings.terminal.log_truncate_desc'),
                      minimum: 0,
                    },
                  },
                },
                ssl: {
                  type: 'object',
                  additionalProperties: false,
                  title: t('settings.security.https'),
                  description: t('settings.security.https_desc'),
                  properties: {
                    key: {
                      type: 'string',
                      title: t('settings.security.key'),
                      description: 'The full path to the private key file.',
                    },
                    cert: {
                      type: 'string',
                      title: t('settings.security.cert'),
                      description: 'The full path to the certificate file.',
                    },
                    pfx: {
                      title: t('settings.security.pfx'),
                      type: 'string',
                      description: 'The full path to the PKCS#12 certificate file.',
                    },
                    passphrase: {
                      title: t('settings.security.pass'),
                      type: 'string',
                      description: 'The passphrase for the PKCS#12 certificate file.',
                    },
                  },
                },
                accessoryControl: {
                  title: 'Accessory Control Setup',
                  type: 'object',
                  additionalProperties: false,
                  description: 'The accessory control settings for the Homebridge Glass UI.',
                  properties: {
                    debug: {
                      title: t('settings.accessory.debug'),
                      type: 'boolean',
                      description: t('settings.accessory.debug_desc'),
                    },
                    instanceBlacklist: {
                      title: t('settings.security.ui_control'),
                      type: 'array',
                      description: t('settings.security.ui_control_desc'),
                      items: {
                        title: t('users.label_username'),
                        type: 'string',
                        pattern: '^([A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$',
                      },
                    },
                  },
                },
                linux: {
                  title: 'Linux Server Commands',
                  type: 'object',
                  additionalProperties: false,
                  description: 'The Linux server commands for the Homebridge Glass UI.',
                  properties: {
                    shutdown: {
                      title: t('settings.linux.shutdown'),
                      type: 'string',
                      description: t('settings.linux.shutdown_desc'),
                    },
                    restart: {
                      title: t('settings.linux.restart'),
                      type: 'string',
                      description: t('settings.linux.restart_desc'),
                    },
                  },
                },
                proxyHost: {
                  title: t('settings.network.proxy'),
                  type: 'string',
                  pattern: '^[^{}/ :\\\\]+(?::\\d+)?$',
                  description: t('settings.network.proxy_desc'),
                },
                scheduledBackupPath: {
                  title: t('backup.settings_path'),
                  description: 'The full path to where the service should save daily scheduled backups archives.',
                  type: 'string',
                },
                scheduledBackupDisable: {
                  title: 'Disable Scheduled Backups',
                  type: 'boolean',
                  description: 'When enabled, the Homebridge Glass UI will not create daily scheduled backups.',
                },
                scheduledRestartCron: {
                  type: 'string',
                  title: t('settings.startup.scheduled_restart'),
                  description: t('settings.startup.scheduled_restart_desc'),
                },
                disableServerMetricsMonitoring: {
                  title: 'Disable Server Metrics Monitoring',
                  type: 'boolean',
                  description: 'When enabled, the Homebridge Glass UI will not collect or report CPU or memory stats.',
                },
                enableMdnsAdvertise: {
                  title: t('settings.network.mdns_advertise'),
                  type: 'boolean',
                  description: t('settings.network.mdns_advertise_help'),
                },
                plugins: {
                  title: t('menu.label_plugins'),
                  type: 'object',
                  additionalProperties: false,
                  description: 'Settings surrounding plugins that are used by the Homebridge Glass UI.',
                  properties: {
                    hideUpdatesFor: {
                      type: 'array',
                      title: t('config.hide_plugin_updates'),
                      description: 'A list of plugin names for which frontend update notifications will be hidden.',
                      items: {
                        type: 'string',
                        title: t('accessories.plugin'),
                        pattern: '^(?:@[\\w-]+(?:\\.[\\w-]+)*/)?homebridge-[\\w-]+$',
                      },
                    },
                    showBetasFor: {
                      type: 'array',
                      title: 'Prefer Beta Versions For',
                      description: 'A list of plugin names that should prefer beta releases.',
                      items: {
                        type: 'string',
                        title: t('accessories.plugin'),
                        pattern: '^(?:@[\\w-]+(?:\\.[\\w-]+)*/)?homebridge-[\\w-]+$',
                      },
                    },
                    hideChildBridgeSetupFor: {
                      type: 'array',
                      title: t('config.hide_child_bridge_setup'),
                      description: 'A list of plugin names for which the "set up child bridge" recommendation icon will be hidden.',
                      items: {
                        type: 'string',
                        title: t('accessories.plugin'),
                        pattern: '^(?:@[\\w-]+(?:\\.[\\w-]+)*/)?homebridge-[\\w-]+$',
                      },
                    },
                  },
                },
                nodeUpdatePolicy: {
                  type: 'string',
                  title: `${t('plugins.manage.notifications')} (Node.js)`,
                  description: t('plugins.manage.notifications_desc', {
                    pluginName: 'Node.js',
                  }),
                  default: 'all',
                  enum: ['all', 'major', 'none'],
                  oneOf: [
                    {
                      title: t('plugins.manage.notifications_all'),
                      description: t('plugins.manage.notifications_all_desc_for', {
                        pluginName: 'Node.js',
                      }),
                      const: 'all',
                    },
                    {
                      title: t('plugins.manage.notifications_major'),
                      description: t('plugins.manage.notifications_major_desc_for', {
                        pluginName: 'Node.js',
                      }),
                      const: 'major',
                    },
                    {
                      title: t('plugins.manage.notifications_none'),
                      description: t('plugins.manage.notifications_none_desc_for', {
                        pluginName: 'Node.js',
                      }),
                      const: 'none',
                    },
                  ],
                },
                homebridgeUpdatePolicy: {
                  type: 'string',
                  title: `${t('plugins.manage.notifications')} (Homebridge)`,
                  description: t('plugins.manage.notifications_desc', {
                    pluginName: 'Homebridge',
                  }),
                  default: 'all',
                  enum: ['all', 'beta', 'major', 'none'],
                  oneOf: [
                    {
                      title: t('plugins.manage.notifications_all'),
                      description: t('plugins.manage.notifications_all_desc_for', {
                        pluginName: 'Homebridge',
                      }),
                      const: 'all',
                    },
                    {
                      title: t('plugins.manage.notifications_beta'),
                      description: t('plugins.manage.notifications_beta_desc_for', {
                        pluginName: 'Homebridge',
                      }),
                      const: 'beta',
                    },
                    {
                      title: t('plugins.manage.notifications_major'),
                      description: t('plugins.manage.notifications_major_desc_for', {
                        pluginName: 'Homebridge',
                      }),
                      const: 'major',
                    },
                    {
                      title: t('plugins.manage.notifications_none'),
                      description: t('plugins.manage.notifications_none_desc_for', {
                        pluginName: 'Homebridge',
                      }),
                      const: 'none',
                    },
                  ],
                },
                homebridgeUiUpdatePolicy: {
                  type: 'string',
                  title: `${t('plugins.manage.notifications')} (Homebridge Glass UI)`,
                  description: t('plugins.manage.notifications_desc', {
                    pluginName: 'Homebridge Glass UI',
                  }),
                  default: 'all',
                  enum: ['all', 'beta', 'major', 'none'],
                  oneOf: [
                    {
                      title: t('plugins.manage.notifications_all'),
                      description: t('plugins.manage.notifications_all_desc_for', {
                        pluginName: 'Homebridge Glass UI',
                      }),
                      const: 'all',
                    },
                    {
                      title: t('plugins.manage.notifications_beta'),
                      description: t('plugins.manage.notifications_beta_desc_for', {
                        pluginName: 'Homebridge Glass UI',
                      }),
                      const: 'beta',
                    },
                    {
                      title: t('plugins.manage.notifications_major'),
                      description: t('plugins.manage.notifications_major_desc_for', {
                        pluginName: 'Homebridge Glass UI',
                      }),
                      const: 'major',
                    },
                    {
                      title: t('plugins.manage.notifications_none'),
                      description: t('plugins.manage.notifications_none_desc_for', {
                        pluginName: 'Homebridge Glass UI',
                      }),
                      const: 'none',
                    },
                  ],
                },
                bridges: {
                  type: 'array',
                  title: t('child_bridge.bridges'),
                  description: 'Settings surrounding bridges that are used by the Homebridge Glass UI.',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['username'],
                    properties: {
                      username: {
                        type: 'string',
                        title: t('users.label_username'),
                        description: 'The MAC address of the bridge (e.g., "0E:02:9A:9D:44:45").',
                        pattern: '^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$',
                      },
                      hideHapAlert: {
                        type: 'boolean',
                        title: t('config.hide_hap_pairing'),
                        description: 'Hide the HAP pairing alert for this bridge.',
                      },
                      hideMatterAlert: {
                        type: 'boolean',
                        title: t('config.hide_matter_pairing'),
                        description: 'Hide the Matter pairing alert for this bridge.',
                      },
                      scheduledRestartCron: {
                        type: 'string',
                        title: t('settings.startup.scheduled_restart'),
                        description: t('settings.startup.scheduled_restart_desc'),
                      },
                    },
                  },
                },
                terminal: {
                  type: 'object',
                  additionalProperties: false,
                  title: 'Terminal Settings',
                  description: 'The terminal settings for the Homebridge Glass UI.',
                  properties: {
                    persistence: {
                      title: t('settings.terminal.persistence'),
                      type: 'boolean',
                      description: t('settings.terminal.persistence_help'),
                      default: false,
                    },
                    hideWarning: {
                      title: t('settings.terminal.warning'),
                      type: 'boolean',
                      description: t('settings.terminal.warning_help'),
                      default: false,
                    },
                    bufferSize: {
                      title: t('settings.terminal.buffer_size'),
                      type: 'integer',
                      description: t('settings.terminal.buffer_size_help'),
                      default: 50000,
                      minimum: 0,
                    },
                    fontSize: {
                      title: t('settings.terminal.font_size'),
                      type: ['string', 'number'],
                      description: t('settings.terminal.font_size_desc'),
                      default: 13,
                      minimum: 10,
                      maximum: 20,
                    },
                    fontWeight: {
                      title: t('settings.terminal.font_weight'),
                      type: ['string', 'number'],
                      description: t('settings.terminal.font_weight_desc'),
                      default: '400',
                      enum: ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'bold', 'normal'],
                    },
                    lightingMode: {
                      title: t('settings.display.lighting_mode'),
                      type: 'string',
                      description: t('settings.terminal.font_lighting_desc'),
                      default: 'dark',
                      enum: ['light', 'dark'],
                    },
                  },
                },
              },
            },
          ],
        },
      },
      accessories: {
        type: 'array',
        title: t('menu.label_accessories'),
        description: 'Any plugin that exposes an accessory should have its config entered in this array.\n'
          + 'Separate each plugin config block using a comma.',
        items: {
          type: 'object',
          required: ['accessory', 'name'],
          title: t('plugins.button_settings'),
          properties: {
            accessory: {
              type: 'string',
              title: t('child_bridge.config.accessory'),
              description: 'This is used by Homebridge to identify which plugin this accessory belongs to.',
            },
            name: {
              type: 'string',
              title: t('accessories.name'),
              description: 'The name of the accessory.',
            },
            _bridge: childBridgeSchema,
          },
        },
      },
      plugins: {
        type: 'array',
        title: t('menu.label_plugins'),
        description: 'An array of plugins that should be selectively enabled.\n'
          + 'Remove this array to enable all plugins.',
        items: {
          type: 'string',
          title: t('accessories.plugin'),
          description: 'The full plugin npm package name.'
            + '\nExample: homebridge-dummy.',
        },
        default: ['@mp-consulting/homebridge-config-glass-ui'],
      },
      disabledPlugins: {
        type: 'array',
        description: 'An array of plugins that should be disabled.\n'
          + 'Requires Homebridge v1.3 or later.',
        items: {
          type: 'string',
          title: t('accessories.plugin'),
          description: 'The full plugin npm package name.\n'
            + 'Example: homebridge-dummy.',
        },
        default: [],
      },
    },
  }
}
