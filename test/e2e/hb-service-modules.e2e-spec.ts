import type { Logger } from '../../src/bin/logger.js'

import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import {
  BRIDGE_PORT_RANGE,
  createBridgeConfig,
  createDefaultConfig,
  createUiConfig,
  parseUiPort,
  repairServiceConfig,
} from '../../src/bin/hb-service/config-bootstrap.js'
import { logTruncationLimits } from '../../src/bin/hb-service/log-tools.js'
import { parseNpmPackageString, parsePluginTarget, pluginNpmArgs } from '../../src/bin/hb-service/plugin-cli.js'
import { createLineBuffer } from '../../src/bin/hb-service/process-supervisor.js'
import { RE_PIN, RE_USERNAME } from '../../src/core/regex.constants.js'

const GLASS_UI = '@mp-consulting/homebridge-config-glass-ui'

describe('hb-service plugin-cli', () => {
  it('parses package names with and without a scope, version and path', () => {
    expect(parseNpmPackageString('homebridge-foo')).toEqual({ name: 'homebridge-foo', version: 'latest', path: '' })
    expect(parseNpmPackageString('homebridge-foo@1.2.3')).toEqual({ name: 'homebridge-foo', version: '1.2.3', path: '' })
    expect(parseNpmPackageString('@scope/homebridge-foo@beta')).toEqual({ name: '@scope/homebridge-foo', version: 'beta', path: '' })
    expect(parseNpmPackageString('@scope/homebridge-foo/lib/x.js')).toEqual({ name: '@scope/homebridge-foo', version: 'latest', path: '/lib/x.js' })
    expect(parseNpmPackageString('/absolute')).toBeNull()
    expect(parseNpmPackageString('@scope')).toBeNull()
  })

  it('accepts only homebridge plugins with a semver-shaped version or tag', () => {
    expect(parsePluginTarget('homebridge-foo@^1.0.0')).toEqual({ target: { name: 'homebridge-foo', version: '^1.0.0', path: '' } })
    expect(parsePluginTarget('@scope/homebridge-foo')).toEqual({ target: { name: '@scope/homebridge-foo', version: 'latest', path: '' } })
    expect(parsePluginTarget('left-pad')).toEqual({ error: 'Invalid plugin name.' })
    expect(parsePluginTarget('@scope')).toEqual({ error: 'Invalid plugin name.' })
    expect(parsePluginTarget('homebridge-foo@1.0.0;rm -rf ~')).toEqual({ error: 'Invalid plugin version "1.0.0;rm -rf ~".' })
    expect(parsePluginTarget('homebridge-foo@$(id)')).toEqual({ error: 'Invalid plugin version "$(id)".' })
  })

  it('builds the npm arguments for add and remove', () => {
    const target = { name: 'homebridge-foo', version: '1.2.3', path: '' }
    expect(pluginNpmArgs('add', target, '/var/lib/homebridge')).toEqual(['--prefix', '/var/lib/homebridge', 'add', 'homebridge-foo@1.2.3'])
    expect(pluginNpmArgs('remove', target, '/var/lib/homebridge')).toEqual(['--prefix', '/var/lib/homebridge', 'remove', 'homebridge-foo'])
  })
})

describe('hb-service config-bootstrap', () => {
  const logger = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() }) as unknown as Logger

  it('creates a bridge block named after its username', () => {
    const bridge = createBridgeConfig(51234, 'bonjour-hap')
    expect(bridge.username).toMatch(RE_USERNAME)
    expect(bridge.pin).toMatch(RE_PIN)
    expect(bridge.port).toBe(51234)
    expect(bridge.advertiser).toBe('bonjour-hap')
    expect(bridge.name).toBe(`Homebridge ${bridge.username.slice(-5).replace(':', '')}`)
  })

  it('creates the default config.json', () => {
    const bridge = createBridgeConfig(51234, 'avahi')
    expect(createDefaultConfig(bridge, createUiConfig(8581))).toEqual({
      bridge,
      accessories: [],
      platforms: [{ name: 'Config', port: 8581, platform: 'config' }],
    })
    expect(BRIDGE_PORT_RANGE).toEqual({ min: 51000, max: 52000 })
  })

  it('reads a UI port from a file or env value', () => {
    expect(parseUiPort('8080\n')).toBe(8080)
    expect(parseUiPort('65536')).toBeNull()
    expect(parseUiPort('abc')).toBeNull()
    expect(parseUiPort(undefined)).toBeNull()
  })

  const context = (overrides: Partial<Parameters<typeof repairServiceConfig>[1]> = {}) => {
    let nextPort = 51000
    return {
      action: 'run' as const,
      uiPort: 8581,
      configPath: '/storage/config.json',
      logger: logger(),
      lastKnownUiPort: vi.fn(async () => 8581),
      generatePort: vi.fn(async () => nextPort++),
      generateBridgeConfig: vi.fn(async () => createBridgeConfig(nextPort++, 'bonjour-hap')),
      createUiConfig: vi.fn(async () => createUiConfig(8581)),
      ...overrides,
    }
  }

  it('leaves a complete config alone', async () => {
    const config = {
      bridge: { name: 'HB', username: '0E:00:00:00:00:01', port: 51826, pin: '031-45-154' },
      platforms: [{ platform: 'config', port: 8581 }],
    }
    const before = structuredClone(config)
    expect(await repairServiceConfig(config, context())).toEqual({ saveRequired: false, restartRequired: false })
    expect(config).toEqual(before)
  })

  it('adds the UI block and the bridge to an empty config', async () => {
    const config: any = {}
    const ctx = context()
    expect(await repairServiceConfig(config, ctx)).toEqual({ saveRequired: true, restartRequired: true })
    expect(config.platforms).toEqual([{ name: 'Config', port: 8581, platform: 'config' }])
    expect(config.bridge.port).toBe(51000)
    expect(ctx.generateBridgeConfig).toHaveBeenCalledTimes(1)
  })

  it('moves a bridge port that clashes with the UI port or 8080', async () => {
    for (const port of [8581, 8080]) {
      const config: any = { bridge: { port }, platforms: [{ platform: 'config', port: 8581 }] }
      expect(await repairServiceConfig(config, context())).toEqual({ saveRequired: true, restartRequired: false })
      expect(config.bridge.port).toBe(51000)
    }
  })

  it('removes an unsafe child bridge NODE_OPTIONS before Homebridge starts, keeping the rest', async () => {
    const config: any = {
      bridge: { port: 51826 },
      platforms: [
        { platform: 'config', port: 8581 },
        { platform: 'Safe', _bridge: { username: '0E:00:00:00:00:02', env: { NODE_OPTIONS: '--max-old-space-size=256' } } },
      ],
      accessories: [
        { accessory: 'Bad', _bridge: { username: '0E:00:00:00:00:03', env: { NODE_OPTIONS: '--require /tmp/x.js', DEBUG: '*' } } },
        { accessory: 'OnlyBad', _bridge: { username: '0E:00:00:00:00:04', env: { NODE_OPTIONS: '--import=data:text/javascript,1' } } },
      ],
    }
    const ctx = context()

    expect(await repairServiceConfig(config, ctx)).toEqual({ saveRequired: true, restartRequired: false })

    expect(config.platforms[1]._bridge.env).toEqual({ NODE_OPTIONS: '--max-old-space-size=256' })
    expect(config.accessories[0]._bridge.env).toEqual({ DEBUG: '*' })
    expect(config.accessories[1]._bridge.env).toBeUndefined()
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('accessories[0]._bridge.env.NODE_OPTIONS'))
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('accessories[1]._bridge.env.NODE_OPTIONS'))
  })

  it('fills a missing UI port from the last known port', async () => {
    const config: any = { bridge: { port: 51826 }, platforms: [{ platform: 'config' }] }
    const ctx = context({ lastKnownUiPort: vi.fn(async () => 8282) })
    expect(await repairServiceConfig(config, ctx)).toEqual({ saveRequired: true, restartRequired: true })
    expect(config.platforms[0].port).toBe(8282)
  })

  it('applies the --port and drops restart/sudo/log settings on install', async () => {
    const config: any = {
      bridge: { port: 51826 },
      platforms: [{ platform: 'config', port: 8581, restart: 'x', sudo: true, log: { method: 'file' } }],
    }
    const ctx = context({ action: 'install', uiPort: 9000 })
    expect(await repairServiceConfig(config, ctx)).toEqual({ saveRequired: true, restartRequired: false })
    expect(config.platforms[0]).toEqual({ platform: 'config', port: 9000 })
    expect(ctx.logger.warn).toHaveBeenCalledWith('Homebridge Glass UI port in /storage/config.json changed to: 9000.')
  })

  it('adds this plugin to a plugins allow-list', async () => {
    const config: any = { bridge: { port: 51826 }, platforms: [{ platform: 'config', port: 8581 }], plugins: ['homebridge-foo'] }
    expect(await repairServiceConfig(config, context())).toEqual({ saveRequired: true, restartRequired: false })
    expect(config.plugins).toEqual(['homebridge-foo', GLASS_UI])
  })
})

describe('hb-service log-tools', () => {
  it('reads the truncation limits from the UI block, with defaults', () => {
    expect(logTruncationLimits({ platforms: [] })).toEqual({ maxSize: 1000000, truncateSize: 200000 })
    expect(logTruncationLimits({})).toEqual({ maxSize: 1000000, truncateSize: 200000 })
    expect(logTruncationLimits({ platforms: [{ platform: 'config', log: { maxSize: -1, truncateSize: 10 } }] }))
      .toEqual({ maxSize: -1, truncateSize: 10 })
  })
})

describe('hb-service process-supervisor', () => {
  it('writes whole lines only, and the rest at the end', () => {
    const written: string[] = []
    const lines = createLineBuffer(text => written.push(text))

    lines.push(Buffer.from('one\ntw'))
    expect(written).toEqual(['one\n'])
    lines.push(Buffer.from('o\nthree'))
    expect(written).toEqual(['one\n', 'two\n'])
    lines.end()
    expect(written).toEqual(['one\n', 'two\n', 'three\n'])
  })

  it('does not split a multi-byte character across chunks', () => {
    const written: string[] = []
    const lines = createLineBuffer(text => written.push(text))
    const bytes = Buffer.from('café\n')

    lines.push(bytes.subarray(0, 4))
    lines.push(bytes.subarray(4))
    expect(written).toEqual(['café\n'])
  })
})
