import { join } from 'node:path'

import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { pathExists, remove } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { MatterConfig } from '../../core/matter/matter.interfaces.js'
import { RE_COLON } from '../../core/regex.constants.js'
import { ConfigEditorService } from './config-editor.service.js'

/**
 * Main-bridge protocol settings stored in config.json: the Matter port range,
 * the `bridge.matter` block and the HAP enable/disable options.
 */
@Injectable()
export class ConfigProtocolService {
  constructor(
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
    @Inject(ConfigEditorService) private readonly configEditorService: ConfigEditorService,
  ) {}

  /**
   * Get the Matter port range configuration
   */
  public async getMatterPortRange(): Promise<{ start?: number, end?: number }> {
    const config = await this.configEditorService.getConfigFile()
    return {
      start: config.matterPorts?.start,
      end: config.matterPorts?.end,
    }
  }

  /**
   * Set the Matter port range configuration
   */
  public async setMatterPortRange(value: { start?: number, end?: number }): Promise<void> {
    this.validateMatterPortRange(value)

    let config = await this.configEditorService.getConfigFile()

    // Clean null values
    if (value.start === null || value.start === undefined) {
      delete value.start
    }
    if (value.end === null || value.end === undefined) {
      delete value.end
    }

    // Remove matterPorts if neither start nor end is specified
    if (!value.start && !value.end) {
      delete config.matterPorts
    } else {
      config.matterPorts = {}
      if (value.start) {
        config.matterPorts.start = value.start
      }
      if (value.end) {
        config.matterPorts.end = value.end
      }
    }

    // Bring matterPorts after ports in config ordering
    const { bridge, ports, matterPorts, ...rest } = config
    config = matterPorts
      ? (ports ? { bridge, ports, matterPorts, ...rest } : { bridge, matterPorts, ...rest })
      : (ports ? { bridge, ports, ...rest } : { bridge, ...rest })

    await this.configEditorService.updateConfigFile(config)
  }

  /**
   * Validate the Matter port range configuration
   */
  private validateMatterPortRange(value: { start?: number, end?: number }): void {
    if (value.start !== null && value.start !== undefined) {
      if (typeof value.start !== 'number' || value.start < 1025 || value.start > 65533) {
        throw new BadRequestException('Matter port range start must be a number between 1025 and 65533.')
      }
    }
    if (value.end !== null && value.end !== undefined) {
      if (typeof value.end !== 'number' || value.end < 1025 || value.end > 65533) {
        throw new BadRequestException('Matter port range end must be a number between 1025 and 65533.')
      }
    }
    if (value.start && value.end && value.start >= value.end) {
      throw new BadRequestException('Matter port range start must be less than end.')
    }
  }

  /**
   * Get the Matter configuration from config.bridge.matter.
   * Returns null when Matter is not configured at all. When configured the
   * block is returned as-is, including `enabled: false` for the in-place
   * disabled state (callers check `enabled` to tell disabled from absent).
   */
  public async getMatterConfig(): Promise<MatterConfig | null> {
    const config = await this.configEditorService.getConfigFile()
    return config.bridge.matter || null
  }

  /**
   * Update the Matter configuration in config.bridge.matter
   */
  public async updateMatterConfig(matterConfig: MatterConfig): Promise<MatterConfig> {
    // Validate the configuration
    this.validateMatterConfig(matterConfig)

    const config = await this.configEditorService.getConfigFile()
    config.bridge.matter = matterConfig
    await this.configEditorService.updateConfigFile(config)
    return matterConfig
  }

  /**
   * Enable or disable Matter in place on the main bridge, without tearing down
   * the config or commissioning storage. Mirrors setHapEnabled: disabling sets
   * `bridge.matter.enabled = false` (block + storage preserved, so re-enabling
   * keeps commissioning); enabling clears the flag. Requires Matter to already
   * be configured — use updateMatterConfig to configure it from scratch, and
   * deleteMatterConfig to fully remove it (and its storage).
   */
  public async setMatterEnabled(
    enabled: boolean,
    restart = true,
    externalsOnly = false,
  ): Promise<{ enabled: boolean, externalsOnly: boolean }> {
    const config = await this.configEditorService.getConfigFile()
    if (!config.bridge?.matter) {
      throw new BadRequestException('Matter is not configured on the main bridge.')
    }

    const useExternalsOnly = this.configService.getFeatureFlags().protocolExternalsOnly === true
    const currentlyEnabled = config.bridge.matter.enabled !== false
    const currentlyExternalsOnly = config.bridge.matter.externalsOnly === true
    const targetExternalsOnly = useExternalsOnly && !enabled && externalsOnly

    if (enabled === currentlyEnabled && targetExternalsOnly === currentlyExternalsOnly) {
      return { enabled, externalsOnly: currentlyExternalsOnly }
    }

    // Shutdown first so the running server doesn't see a partial config, unless
    // the caller will trigger a (deferred) restart itself.
    if (restart) {
      await this.homebridgeIpcService.restartAndWaitForClose()
    }
    if (enabled) {
      // Re-enable: omit the flag — present-without-`enabled` means enabled.
      // externalsOnly must be cleared too (validation rejects enabled + externalsOnly).
      delete config.bridge.matter.enabled
      delete config.bridge.matter.externalsOnly
    } else {
      config.bridge.matter.enabled = false
      if (targetExternalsOnly) {
        config.bridge.matter.externalsOnly = true
      } else {
        delete config.bridge.matter.externalsOnly
      }
    }
    await this.configEditorService.updateConfigFile(config)
    return { enabled, externalsOnly: targetExternalsOnly }
  }

  /**
   * Delete the Matter configuration from config.bridge.matter
   */
  public async deleteMatterConfig(): Promise<void> {
    const config = await this.configEditorService.getConfigFile()
    const deviceId = config.bridge.username.replace(RE_COLON, '').toUpperCase()

    // 1. Shutdown first to prevent Homebridge from reacting to partial config
    await this.homebridgeIpcService.restartAndWaitForClose()

    // 2. Update config
    delete config.bridge.matter
    await this.configEditorService.updateConfigFile(config)

    // 3. Delete storage
    const matterPath = join(this.configService.storagePath, 'matter', deviceId)
    if (await pathExists(matterPath)) {
      await remove(matterPath)
      this.logger.warn(`Bridge ${deviceId} reset: removed Matter bridge storage at ${matterPath}.`)
    }
  }

  /**
   * Get whether HAP is enabled on the main bridge, plus nested HAP options
   * supported by newer Homebridge versions.
   *
   * HAP is enabled by default; users opt out via either the legacy boolean
   * form (`bridge.hap: false`, older Homebridge) or the nested form
   * (`bridge.hap: { enabled: false, externalsOnly?: true,
   * disableIdentifyingMaterial?: true }`, newer Homebridge versions).
   * Reading tolerates both shapes; writing chooses the appropriate shape
   * based on the applicable feature flags.
   */
  public async getHapEnabled(): Promise<{ enabled: boolean, externalsOnly: boolean, disableIdentifyingMaterial: boolean }> {
    const config = await this.configEditorService.getConfigFile()
    const hap = config.bridge?.hap
    // Legacy: hap === false means disabled.
    if (hap === false) {
      return { enabled: false, externalsOnly: false, disableIdentifyingMaterial: false }
    }
    // Nested: { enabled: false } means disabled; other options are surfaced
    // independently of the running version so manually-authored configs remain visible.
    if (typeof hap === 'object' && hap !== null) {
      const enabled = hap.enabled !== false
      const externalsOnly = hap.externalsOnly === true
      const disableIdentifyingMaterial = hap.disableIdentifyingMaterial === true
      return { enabled, externalsOnly, disableIdentifyingMaterial }
    }
    return { enabled: true, externalsOnly: false, disableIdentifyingMaterial: false }
  }

  /**
   * Enable or disable HAP on the main bridge.
   *
   * Writes either the boolean form or the nested object form based on the
   * running Homebridge version. When disabling, the optional `externalsOnly`
   * flag is honoured only when supported. `disableIdentifyingMaterial` is
   * preserved when older UI clients omit it from a HAP enablement request.
   *
   * @param enabled - Whether HAP should be published.
   * @param restart - Whether to restart Homebridge after the change (deferred to caller when false).
   * @param externalsOnly - Optional. When `enabled: false`, additionally suppress the bridge accessory itself (externals still publish).
   * @param disableIdentifyingMaterial - Optional. Whether HAP-NodeJS should omit username-derived identifying material from published names.
   */
  public async setHapEnabled(
    enabled: boolean,
    restart = true,
    externalsOnly = false,
    disableIdentifyingMaterial?: boolean,
  ): Promise<{ enabled: boolean, externalsOnly: boolean, disableIdentifyingMaterial: boolean }> {
    if (disableIdentifyingMaterial !== undefined && typeof disableIdentifyingMaterial !== 'boolean') {
      throw new BadRequestException('HAP disableIdentifyingMaterial must be a boolean.')
    }

    const config = await this.configEditorService.getConfigFile()
    const featureFlags = this.configService.getFeatureFlags()
    const supportsExternalsOnly = featureFlags.protocolExternalsOnly === true
    const supportsDisableIdentifyingMaterial = featureFlags.hapDisableIdentifyingMaterial === true
    const useNestedShape = supportsExternalsOnly || supportsDisableIdentifyingMaterial
    const currentHap = config.bridge?.hap
    const currentDisableIdentifyingMaterial = typeof currentHap === 'object'
      && currentHap !== null
      && currentHap.disableIdentifyingMaterial === true
    const targetDisableIdentifyingMaterial = supportsDisableIdentifyingMaterial
      && (disableIdentifyingMaterial ?? currentDisableIdentifyingMaterial)
    const targetExternalsOnly = supportsExternalsOnly && !enabled && externalsOnly

    if (!enabled) {
      // Shutdown first so the running server doesn't see a partial config, unless
      // the caller will trigger a (deferred) restart itself.
      if (restart) {
        await this.homebridgeIpcService.restartAndWaitForClose()
      }
      if (useNestedShape) {
        config.bridge.hap = {
          enabled: false,
          ...(targetExternalsOnly ? { externalsOnly: true } : {}),
          ...(targetDisableIdentifyingMaterial ? { disableIdentifyingMaterial: true } : {}),
        }
      } else {
        // Legacy runtime: externalsOnly is ignored (the runtime would reject the nested form).
        config.bridge.hap = false
      }
      await this.configEditorService.updateConfigFile(config)
    } else {
      // Re-enable: clear enabled/externalsOnly while retaining the identifying
      // material preference. If it is off, drop the property entirely so the
      // default HAP behavior takes effect.
      if (targetDisableIdentifyingMaterial) {
        config.bridge.hap = { disableIdentifyingMaterial: true }
        await this.configEditorService.updateConfigFile(config)
      } else if (currentHap === false || (typeof currentHap === 'object' && currentHap !== null)) {
        delete config.bridge.hap
        await this.configEditorService.updateConfigFile(config)
      }
    }
    return {
      enabled,
      externalsOnly: targetExternalsOnly,
      disableIdentifyingMaterial: targetDisableIdentifyingMaterial,
    }
  }

  /**
   * Validate Matter configuration
   * @param matterConfig - The Matter configuration to validate
   * @throws BadRequestException if configuration is invalid
   */
  private validateMatterConfig(matterConfig: MatterConfig): void {
    // Validate port
    if (matterConfig.port !== undefined) {
      if (
        typeof matterConfig.port !== 'number'
        || !Number.isInteger(matterConfig.port)
        || matterConfig.port < 1024
        || matterConfig.port > 65535
      ) {
        throw new BadRequestException('Port must be an integer between 1024 and 65535')
      }

      // Check for reserved ports
      if ([5353, 8080, 8443].includes(matterConfig.port)) {
        throw new BadRequestException('Port 5353, 8080, and 8443 are reserved and cannot be used')
      }
    }

    // Validate disableIpv4
    if (matterConfig.disableIpv4 !== undefined && typeof matterConfig.disableIpv4 !== 'boolean') {
      throw new BadRequestException('disableIpv4 must be a boolean')
    }
  }
}
