/* global NodeJS */
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

import { copy, writeJson } from 'fs-extra'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { testStoragePath } from '../storage-path.js'

describe('mDNS Service (e2e)', () => {
  let authFilePath: string
  let secretsFilePath: string
  let configPath: string
  let originalEnv: NodeJS.ProcessEnv

  beforeAll(async () => {
    // Save original environment
    originalEnv = { ...process.env }

    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    configPath = process.env.UIX_CONFIG_PATH
    authFilePath = resolve(process.env.UIX_STORAGE_PATH, 'auth.json')
    secretsFilePath = resolve(process.env.UIX_STORAGE_PATH, '.uix-secrets')

    // Setup test config
    await copy(resolve(__dirname, '../mocks', 'config.json'), configPath)

    // Setup test auth file
    await copy(resolve(__dirname, '../mocks', 'auth.json'), authFilePath)
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), secretsFilePath)
  })

  afterAll(async () => {
    // Restore original environment
    process.env = originalEnv
  })

  describe('Bonjour Service Module', () => {
    it('should import bonjour-service without errors', async () => {
      const { Bonjour, Browser, Service } = await import('bonjour-service')
      expect(Bonjour).toBeTypeOf('function')
      expect(Browser).toBeTypeOf('function')
      expect(Service).toBeTypeOf('function')
    })

    it('should create a Bonjour instance with required methods', async () => {
      const { Bonjour } = await import('bonjour-service')
      const bonjour = new Bonjour()

      expect(bonjour).toBeInstanceOf(Bonjour)
      expect(typeof bonjour.publish).toBe('function')
      expect(typeof bonjour.unpublishAll).toBe('function')
      expect(typeof bonjour.destroy).toBe('function')
      expect(typeof bonjour.find).toBe('function')

      bonjour.destroy()
    })

    it('should publish a test service successfully', async () => {
      const { Bonjour, Service } = await import('bonjour-service')
      const bonjour = new Bonjour()

      const service = bonjour.publish({
        name: 'Test Homebridge Glass UI',
        type: 'http',
        port: 8581,
        txt: {
          path: '/',
          version: 'test-1.0.0',
          https: 'false',
        },
      })

      expect(service).toBeInstanceOf(Service)
      expect(service).toMatchObject({
        name: 'Test Homebridge Glass UI',
        type: '_http._tcp',
        protocol: 'tcp',
        port: 8581,
        fqdn: 'Test Homebridge Glass UI._http._tcp.local',
        txt: { path: '/', version: 'test-1.0.0', https: 'false' },
      })

      bonjour.unpublishAll()
      bonjour.destroy()
    })

    it('should start a browser for the published service type', async () => {
      const { Bonjour, Browser } = await import('bonjour-service')
      const bonjour = new Bonjour()

      bonjour.publish({
        name: 'Discovery Test UI',
        type: 'http',
        port: 8582,
        txt: {
          path: '/test',
          version: '1.0.0',
        },
      })

      // Whether the service is actually seen depends on the host's multicast
      // support, so only the browser itself is asserted - without waiting on
      // the network for an answer that may never come.
      const browser = bonjour.find({ type: 'http' })

      expect(browser).toBeInstanceOf(Browser)
      expect(Array.isArray(browser.services)).toBe(true)

      browser.stop()
      bonjour.unpublishAll()
      bonjour.destroy()
    })
  })

  describe('mDNS Configuration', () => {
    let ConfigService: any
    let configService: any

    beforeEach(async () => {
      // Reset modules to ensure clean state
      vi.resetModules()

      // Import ConfigService
      const configModule = await import('../../src/core/config/config.service.js')
      ConfigService = configModule.ConfigService
    })

    it('should handle enableMdnsAdvertise config option', async () => {
      // Create config with mDNS enabled
      const testConfig = {
        bridge: {
          name: 'Test Bridge',
          username: '0E:89:49:64:91:86',
          port: 51173,
          pin: '630-27-655',
        },
        platforms: [{
          platform: 'config',
          name: 'Config',
          port: 8581,
          enableMdnsAdvertise: true,
        }],
      }

      await writeJson(configPath, testConfig)

      configService = new ConfigService()
      configService.parseConfig(testConfig)

      expect(configService.ui).toMatchObject({ platform: 'config', name: 'Config', port: 8581, enableMdnsAdvertise: true })
    })

    it('should default to false when enableMdnsAdvertise is not set', async () => {
      const testConfig = {
        bridge: {
          name: 'Test Bridge',
          username: '0E:89:49:64:91:86',
          port: 51173,
          pin: '630-27-655',
        },
        platforms: [{
          platform: 'config',
          name: 'Config',
          port: 8581,
        }],
      }

      await writeJson(configPath, testConfig)

      configService = new ConfigService()
      configService.parseConfig(testConfig)

      expect(configService.ui).toMatchObject({ platform: 'config', name: 'Config', port: 8581 })
      expect(configService.ui).not.toHaveProperty('enableMdnsAdvertise')
    })

    it('should use bridge name for mDNS service name', async () => {
      const testConfig = {
        bridge: {
          name: 'My Custom Bridge',
          username: '0E:89:49:64:91:86',
          port: 51173,
          pin: '630-27-655',
        },
        platforms: [{
          platform: 'config',
          name: 'Config',
          port: 8581,
          enableMdnsAdvertise: true,
        }],
      }

      await writeJson(configPath, testConfig)

      configService = new ConfigService()
      configService.parseConfig(testConfig)

      expect(configService.homebridgeConfig.bridge.name).toBe('My Custom Bridge')

      // Test service name generation logic
      const serviceName = configService.homebridgeConfig?.bridge?.name
        ? configService.homebridgeConfig.bridge.name
        : 'Homebridge Glass UI'

      expect(serviceName).toBe('My Custom Bridge')
    })

    it('should handle HTTPS configuration in mDNS', async () => {
      const testConfig = {
        bridge: {
          name: 'Test Bridge',
          username: '0E:89:49:64:91:86',
          port: 51173,
          pin: '630-27-655',
        },
        platforms: [{
          platform: 'config',
          name: 'Config',
          port: 8581,
          ssl: {
            key: '/path/to/key.pem',
            cert: '/path/to/cert.pem',
          },
          enableMdnsAdvertise: true,
        }],
      }

      await writeJson(configPath, testConfig)

      configService = new ConfigService()
      configService.parseConfig(testConfig)

      expect(configService.ui.ssl).toEqual({ key: '/path/to/key.pem', cert: '/path/to/cert.pem' })
    })
  })

  describe('mDNS Service Integration', () => {
    it('should handle multiple service publishing and cleanup', async () => {
      const { Bonjour } = await import('bonjour-service')
      const bonjour = new Bonjour()

      // Publish multiple services
      const services = []
      for (let i = 0; i < 3; i += 1) {
        const service = bonjour.publish({
          name: `Test Service ${i}`,
          type: 'http',
          port: 8580 + i,
          txt: {
            path: '/',
            version: '1.0.0',
          },
        })
        services.push(service)
      }

      expect(services).toHaveLength(3)
      services.forEach((service, index) => {
        expect(service.name).toBe(`Test Service ${index}`)
        expect(service.port).toBe(8580 + index)
      })

      // Clean up all services
      bonjour.unpublishAll()
      bonjour.destroy()
    })

    it('should handle service with special characters in name', async () => {
      const { Bonjour, Service } = await import('bonjour-service')
      const bonjour = new Bonjour()

      const specialNames = [
        'Living Room Bridge UI',
        'Master Bedroom (2nd Floor) UI',
        'Basement-Workshop UI',
        'Guest House #1 UI',
      ]

      for (const name of specialNames) {
        const service = bonjour.publish({
          name,
          type: 'http',
          port: 8581,
        })

        expect(service).toBeInstanceOf(Service)
        expect(service.name).toBe(name)
        expect(service.fqdn).toBe(`${name}._http._tcp.local`)

        bonjour.unpublishAll()
      }

      bonjour.destroy()
    })

    it('should handle network interface binding', async () => {
      const { Bonjour, Service } = await import('bonjour-service')
      const bonjour = new Bonjour()

      // Test with different host configurations
      const hostConfigs = [
        { host: undefined, description: 'all interfaces' },
        { host: '127.0.0.1', description: 'localhost only' },
        { host: '192.168.1.100', description: 'specific IP' },
      ]

      for (const config of hostConfigs) {
        const service = bonjour.publish({
          name: `Test ${config.description}`,
          type: 'http',
          port: 8581,
          host: config.host,
        })

        expect(service).toBeInstanceOf(Service)
        // Without an explicit host the service advertises this machine's name
        expect(service.host).toBe(config.host ?? hostname())

        bonjour.unpublishAll()
      }

      bonjour.destroy()
    })

    it('should handle graceful shutdown', async () => {
      const { Bonjour, Service } = await import('bonjour-service')
      const bonjour = new Bonjour()

      // Publish a service
      const service = bonjour.publish({
        name: 'Shutdown Test UI',
        type: 'http',
        port: 8581,
      })

      expect(service).toBeInstanceOf(Service)
      expect(service.name).toBe('Shutdown Test UI')

      // Simulate graceful shutdown
      let cleanupCalled = false
      const cleanup = () => {
        cleanupCalled = true
        bonjour.unpublishAll()
        bonjour.destroy()
      }

      cleanup()

      expect(cleanupCalled).toBe(true)
    })
  })
})
