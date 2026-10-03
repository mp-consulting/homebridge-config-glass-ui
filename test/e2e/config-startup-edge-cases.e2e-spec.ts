import { resolve } from 'node:path'
import process from 'node:process'

import { outputFile, outputJson, remove } from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getStartupConfig } from '../../src/core/config/config.startup.js'
import { testStoragePath } from '../storage-path.js'

/**
 * getStartupConfig runs before Nest exists, straight off config.json. These
 * cover config files that are broken or lack the UI block.
 */
describe('getStartupConfig edge cases', () => {
  const configPath = resolve(testStoragePath, 'startup-edge', 'config.json')
  const savedEnv = { ...process.env }

  const writeConfig = (config: unknown) => outputJson(configPath, config)
  const withUi = (ui: Record<string, unknown>) => writeConfig({ bridge: {}, platforms: [{ platform: 'config', ...ui }] })

  beforeEach(() => {
    process.env.UIX_CONFIG_PATH = configPath
    process.env.UIX_STORAGE_PATH = resolve(testStoragePath, 'startup-edge')
    delete process.env.UIX_DEVELOPMENT
  })

  afterEach(async () => {
    process.env = { ...savedEnv }
    await remove(resolve(testStoragePath, 'startup-edge'))
  })

  describe('a broken config.json', () => {
    it('rejects on invalid JSON', async () => {
      await outputFile(configPath, '{ "bridge": { ')

      await expect(getStartupConfig()).rejects.toThrow(SyntaxError)
    })

    it('rejects when the file is missing', async () => {
      await expect(getStartupConfig()).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('rejects on an empty file', async () => {
      await outputFile(configPath, '')

      await expect(getStartupConfig()).rejects.toThrow()
    })
  })

  describe('without a UI block', () => {
    it.each([
      ['no platforms key', { bridge: {} }],
      ['platforms is not an array', { bridge: {}, platforms: { platform: 'config' } }],
      ['no config platform', { bridge: {}, platforms: [{ platform: 'Other', host: '10.0.0.1', debug: true }] }],
      ['an empty object', {}],
    ])('%s: returns only a listen host', async (_name, config) => {
      await writeConfig(config)

      const startup = await getStartupConfig()

      expect(Object.keys(startup)).toEqual(['host'])
      expect(['::', '0.0.0.0']).toContain(startup.host)
    })

    it('does not change the debug env var', async () => {
      process.env.UIX_DEBUG_LOGGING = 'untouched'
      await writeConfig({ bridge: {}, platforms: [] })

      await getStartupConfig()

      expect(process.env.UIX_DEBUG_LOGGING).toBe('untouched')
    })
  })

  describe('with a UI block', () => {
    it('uses the configured host and proxy host', async () => {
      await withUi({ host: '192.168.1.5', proxyHost: 'hb.example.com' })

      const startup = await getStartupConfig()

      expect(startup.host).toBe('192.168.1.5')
      expect(startup.cspWsOverride).toBe('wss://hb.example.com ws://hb.example.com')
    })

    it('ignores host, ssl and proxyHost in development mode', async () => {
      process.env.UIX_DEVELOPMENT = '1'
      await withUi({ host: '192.168.1.5', proxyHost: 'hb.example.com', ssl: { key: '/nope.key', cert: '/nope.crt' } })

      const startup = await getStartupConfig()

      expect(startup.host).not.toBe('192.168.1.5')
      expect(startup.cspWsOverride).toBeUndefined()
      expect(startup.httpsOptions).toBeUndefined()
      expect(startup.sslError).toBeUndefined()
    })

    it('splits a string allowFrameAncestors on spaces and commas', async () => {
      await withUi({ allowFrameAncestors: 'https://a.example, https://b.example  https://c.example' })

      expect((await getStartupConfig()).allowedFrameAncestors).toEqual([
        'https://a.example',
        'https://b.example',
        'https://c.example',
      ])
    })

    it('sets the debug flag and env var', async () => {
      await withUi({ debug: true })
      expect((await getStartupConfig()).debug).toBe(true)
      expect(process.env.UIX_DEBUG_LOGGING).toBe('1')

      await withUi({})
      expect((await getStartupConfig()).debug).toBe(false)
      expect(process.env.UIX_DEBUG_LOGGING).toBe('0')
    })

    it('loads a self-signed certificate into httpsOptions', async () => {
      await withUi({ ssl: { selfSigned: true, selfSignedHostnames: ['homebridge.local', '10.0.0.2'] } })

      const startup = await getStartupConfig()

      expect(startup.sslError).toBeUndefined()
      expect(startup.httpsOptions?.key?.toString()).toContain('PRIVATE KEY')
      expect(startup.httpsOptions?.cert?.toString()).toContain('BEGIN CERTIFICATE')
    })

    it('records an sslError when the self-signed certificate cannot be written', async () => {
      // ssl-certs exists as a file, so the cert directory cannot be created
      await outputFile(resolve(testStoragePath, 'startup-edge', 'ssl-certs'), 'not a directory')
      await withUi({ ssl: { selfSigned: true } })

      const startup = await getStartupConfig()

      expect(startup.httpsOptions).toBeUndefined()
      expect(startup.sslError).toMatch(/Could not generate a self-signed certificate/)
    })
  })
})
