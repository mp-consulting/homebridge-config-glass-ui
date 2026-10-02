import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { AccessoriesModule } from '../../src/modules/accessories/accessories.module.js'
import { AccessoriesService } from '../../src/modules/accessories/accessories.service.js'
import { testStoragePath } from '../storage-path.js'

const CORRELATION_ID = /^accessoryControlResponse-\d+-[a-z0-9]+$/

describe('AccessoriesService Matter (e2e)', () => {
  let app: NestFastifyApplication
  let ipc: HomebridgeIpcService
  let svc: any

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(process.env.UIX_STORAGE_PATH, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(process.env.UIX_STORAGE_PATH, '.uix-secrets'))

    const configService = new ConfigService()
    configService.homebridgeInsecureMode = true

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AccessoriesModule, AuthModule],
    }).overrideProvider(ConfigService).useValue(configService).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    ipc = app.get(HomebridgeIpcService)
    svc = app.get(AccessoriesService) as any
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    svc.activeClients.clear()
    svc.matterAccessories = []
    svc.matterRequests.clear()
    vi.spyOn(svc.logger, 'warn').mockImplementation(() => {})
    vi.spyOn(svc.logger, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * Stub the IPC bus: every `sendMessage` call is recorded, and `reply`
   * builds the matterEvent that core would push back for that request.
   */
  function stubIpc(reply: (type: string, data: any) => Record<string, unknown> | undefined) {
    return vi.spyOn(ipc, 'sendMessage').mockImplementation((type: string, data?: any) => {
      const event = reply(type, data)
      if (event) {
        // core replies asynchronously over the process channel
        setImmediate(() => ipc.emit('matterEvent', event))
      }
    })
  }

  function cachedService(overrides: Record<string, unknown> = {}) {
    return {
      uniqueId: 'matter:abc',
      uuid: 'abc',
      bridge: { name: 'Bridge', username: 'AA:BB:CC:DD:EE:FF' },
      clusters: { onOff: { onOff: false, extra: 1 } },
      ...overrides,
    }
  }

  describe('parseMatterUniqueId', () => {
    // the format is what buildMatterUniqueId produces: matter:<uuid>[:<partId>]
    it.each([
      ['matter:abc', { uuid: 'abc', partId: undefined }],
      ['matter:abc:2', { uuid: 'abc', partId: '2' }],
    ])('parses %j', (input, expected) => {
      expect(svc.parseMatterUniqueId(input)).toStrictEqual(expected)
    })

    it('round-trips every id the builder produces', () => {
      for (const [uuid, partId] of [['abc', undefined], ['abc', '2']] as const) {
        expect(svc.parseMatterUniqueId(svc.buildMatterUniqueId(uuid, partId))).toStrictEqual({ uuid, partId })
      }
    })

    it.each([
      'matter:',
      '',
      'matter::2',
      'matter:abc:',
      'matter:abc:2:extra',
      'matter:matter:abc',
      'abc',
      'xmatter:abc',
    ])('rejects the malformed id %j', (input) => {
      expect(() => svc.parseMatterUniqueId(input)).toThrow(`Invalid Matter accessory id '${input}'`)
    })

    it('rejects a malformed id ("matter:") without asking core', async () => {
      const send = stubIpc(() => undefined)

      await expect(svc.getAccessory('matter:')).rejects.toMatchObject({
        status: 400,
        message: 'Invalid Matter accessory id \'matter:\'',
      })
      expect(send).not.toHaveBeenCalled()
    })

    it('reports a malformed control id to the requester without asking core', async () => {
      const send = stubIpc(() => undefined)
      const requester = { emit: vi.fn() }

      await svc.handleMatterControl(requester, { uniqueId: 'matter:abc:2:extra', cluster: 'onOff', attributes: { onOff: true } })

      expect(send).not.toHaveBeenCalled()
      expect(requester.emit).toHaveBeenCalledTimes(1)
      expect(requester.emit).toHaveBeenCalledWith('accessory-control-failure', 'Invalid Matter accessory id \'matter:abc:2:extra\'')
    })

    it('rejects a part id the accessory does not have', async () => {
      stubIpc((type, data) => ({
        type: 'accessoryInfo',
        correlationId: data.correlationId,
        data: { uuid: 'abc', displayName: 'Strip', deviceType: 'Light', clusters: {}, parts: [{ id: '1', displayName: 'A', deviceType: 'Light', clusters: {} }] },
      }))

      await expect(svc.getAccessory('matter:abc:9')).rejects.toMatchObject({
        status: 400,
        message: 'Part \'9\' not found in accessory',
      })
    })

    it('returns the transformed part for a valid part id', async () => {
      stubIpc((type, data) => ({
        type: 'accessoryInfo',
        correlationId: data.correlationId,
        data: { uuid: 'abc', displayName: 'Strip', deviceType: 'Light', clusters: {}, parts: [{ id: '1', displayName: 'A', deviceType: 'Plug', clusters: { onOff: { onOff: true } } }] },
      }))

      const result = await svc.getAccessory('matter:abc:1')
      expect(result.uniqueId).toBe('matter:abc:1')
      expect(result.displayName).toBe('Strip - A')
      expect(result.deviceType).toBe('Plug')
      expect(result.clusters).toStrictEqual({ onOff: { onOff: true } })
    })
  })

  describe('transformMatterAccessory', () => {
    const fabrics = [{ fabricIndex: 1, fabricId: '1', nodeId: '2', rootVendorId: 4937, label: 'Home' }]
    const accessory = {
      uuid: 'abc',
      displayName: 'Lamp',
      deviceType: 'OnOffLight',
      clusters: { onOff: { onOff: true } },
      manufacturer: 'Acme',
      model: 'L1',
      serialNumber: 'SN1',
      firmwareRevision: '2.1.0',
      bridge: { name: 'Main Bridge', username: '0E:00:00:00:00:01' },
      plugin: 'homebridge-acme',
      platform: 'Acme',
      commissioned: true,
      fabricCount: 1,
      fabrics,
    }

    it('maps a fully populated accessory', () => {
      expect(svc.transformMatterAccessory(accessory)).toStrictEqual({
        uniqueId: 'matter:abc',
        uuid: 'abc',
        serviceName: 'Lamp',
        displayName: 'Lamp',
        deviceType: 'OnOffLight',
        clusters: { onOff: { onOff: true } },
        partId: undefined,
        protocol: 'matter',
        instance: { name: 'Main Bridge', username: '0E:00:00:00:00:01' },
        accessoryInformation: {
          'Name': 'Lamp',
          'Manufacturer': 'Acme',
          'Model': 'L1',
          'Serial Number': 'SN1',
          'Firmware Revision': '2.1.0',
        },
        bridge: { name: 'Main Bridge', username: '0E:00:00:00:00:01' },
        plugin: 'homebridge-acme',
        platform: 'Acme',
        commissioned: true,
        fabricCount: 1,
        fabrics,
        aid: 0,
        iid: 0,
      })
      expect(svc.logger.warn).not.toHaveBeenCalled()
    })

    it('maps a part, taking its clusters, device type and id', () => {
      const part = { id: '3', displayName: 'Socket 3', deviceType: 'OnOffPlugInUnit', clusters: { onOff: { onOff: false } } }
      const result = svc.transformMatterAccessory(accessory, part)

      expect(result.uniqueId).toBe('matter:abc:3')
      expect(result.partId).toBe('3')
      expect(result.displayName).toBe('Lamp - Socket 3')
      expect(result.serviceName).toBe('Lamp - Socket 3')
      expect(result.deviceType).toBe('OnOffPlugInUnit')
      expect(result.clusters).toBe(part.clusters)
      expect(result.accessoryInformation).toStrictEqual({
        'Name': 'Lamp - Socket 3',
        'Manufacturer': 'Acme',
        'Model': 'L1',
        'Serial Number': 'SN1',
        'Firmware Revision': '2.1.0',
      })
    })

    it('fills defaults for a minimal accessory and warns about the missing bridge username', () => {
      const result = svc.transformMatterAccessory({ uuid: 'min', displayName: 'Bare', deviceType: 'Sensor', clusters: {} })

      expect(result).toStrictEqual({
        uniqueId: 'matter:min',
        uuid: 'min',
        serviceName: 'Bare',
        displayName: 'Bare',
        deviceType: 'Sensor',
        clusters: {},
        partId: undefined,
        protocol: 'matter',
        instance: { name: 'Matter Bridge', username: 'unknown' },
        accessoryInformation: {
          'Name': 'Bare',
          'Manufacturer': 'Unknown',
          'Model': 'Sensor',
          'Serial Number': 'min',
          'Firmware Revision': '1.0.0',
        },
        bridge: undefined,
        plugin: undefined,
        platform: undefined,
        commissioned: undefined,
        fabricCount: undefined,
        fabrics: undefined,
        aid: 0,
        iid: 0,
      })
      expect(svc.logger.warn).toHaveBeenCalledTimes(1)
      expect(svc.logger.warn).toHaveBeenCalledWith('Matter accessory \'Bare\' (matter:min) has no bridge.username - layout may not persist correctly')
    })
  })

  describe('handleMatterControl', () => {
    it('sends the control over IPC, merges the attributes and broadcasts the service', async () => {
      const service = cachedService()
      svc.matterAccessories = [service]
      const requester = { emit: vi.fn() }
      const viewer = { emit: vi.fn() }
      svc.activeClients.add(viewer)
      const send = stubIpc((type, data) => ({ type: 'accessoryControlResponse', correlationId: data.correlationId, data: { success: true } }))

      await svc.handleMatterControl(requester, { uniqueId: 'matter:abc', cluster: 'onOff', attributes: { onOff: true } })

      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][0]).toBe('matterAccessoryControl')
      expect(send.mock.calls[0][1]).toStrictEqual({
        uuid: 'abc',
        cluster: 'onOff',
        attributes: { onOff: true },
        bridgeUsername: 'AA:BB:CC:DD:EE:FF',
        partId: undefined,
        correlationId: expect.stringMatching(CORRELATION_ID),
      })
      expect(service.clusters.onOff).toStrictEqual({ onOff: true, extra: 1 })
      expect(viewer.emit).toHaveBeenCalledTimes(1)
      expect(viewer.emit).toHaveBeenCalledWith('accessories-data', [service])
      expect(requester.emit).not.toHaveBeenCalled()
      expect(svc.matterRequests.size).toBe(0)
    })

    it('ignores replies with another correlation id or event type', async () => {
      const service = cachedService()
      svc.matterAccessories = [service]
      const viewer = { emit: vi.fn() }
      svc.activeClients.add(viewer)
      vi.spyOn(ipc, 'sendMessage').mockImplementation((_type: string, data?: any) => {
        setImmediate(() => {
          ipc.emit('matterEvent', { type: 'accessoryControlResponse', correlationId: 'someone-else', data: { success: false, error: 'wrong' } })
          ipc.emit('matterEvent', { type: 'accessoryInfo', correlationId: data.correlationId, data: { success: false, error: 'wrong type' } })
          ipc.emit('matterEvent', { type: 'accessoryControlResponse', data: { success: false, error: 'no id' } })
          ipc.emit('matterEvent', null)
          ipc.emit('matterEvent', { type: 'accessoryControlResponse', correlationId: data.correlationId, data: { success: true } })
        })
      })
      const requester = { emit: vi.fn() }

      await svc.handleMatterControl(requester, { uniqueId: 'matter:abc', cluster: 'onOff', attributes: { onOff: true } })

      expect(requester.emit).not.toHaveBeenCalled()
      expect(viewer.emit).toHaveBeenCalledWith('accessories-data', [service])
    })

    it('passes the part id and an undefined bridge for an uncached accessory', async () => {
      const viewer = { emit: vi.fn() }
      svc.activeClients.add(viewer)
      const send = stubIpc((type, data) => ({ type: 'accessoryControlResponse', correlationId: data.correlationId, data: { success: true } }))
      const requester = { emit: vi.fn() }

      await svc.handleMatterControl(requester, { uniqueId: 'matter:zzz:4', cluster: 'levelControl', attributes: { currentLevel: 10 } })

      expect(send.mock.calls[0][1]).toStrictEqual({
        uuid: 'zzz',
        cluster: 'levelControl',
        attributes: { currentLevel: 10 },
        bridgeUsername: undefined,
        partId: '4',
        correlationId: expect.stringMatching(CORRELATION_ID),
      })
      // nothing cached to update, so nobody is notified
      expect(viewer.emit).not.toHaveBeenCalled()
      expect(requester.emit).not.toHaveBeenCalled()
    })

    it('does not broadcast when the cached service lacks the controlled cluster', async () => {
      const service = cachedService()
      svc.matterAccessories = [service]
      const viewer = { emit: vi.fn() }
      svc.activeClients.add(viewer)
      stubIpc((type, data) => ({ type: 'accessoryControlResponse', correlationId: data.correlationId, data: { success: true } }))

      await svc.handleMatterControl({ emit: vi.fn() }, { uniqueId: 'matter:abc', cluster: 'colorControl', attributes: { hue: 5 } })

      expect(service.clusters).toStrictEqual({ onOff: { onOff: false, extra: 1 } })
      expect(viewer.emit).not.toHaveBeenCalled()
    })

    it.each([
      [{ success: false, error: 'Device offline' }, 'Device offline'],
      [{ success: false }, 'Matter control failed'],
    ])('reports a failed response %j to the requester', async (data, message) => {
      const service = cachedService()
      svc.matterAccessories = [service]
      const viewer = { emit: vi.fn() }
      svc.activeClients.add(viewer)
      stubIpc((type, req) => ({ type: 'accessoryControlResponse', correlationId: req.correlationId, data }))
      const requester = { emit: vi.fn() }

      await svc.handleMatterControl(requester, { uniqueId: 'matter:abc', cluster: 'onOff', attributes: { onOff: true } })

      expect(requester.emit).toHaveBeenCalledTimes(1)
      expect(requester.emit).toHaveBeenCalledWith('accessory-control-failure', message)
      expect(service.clusters.onOff).toStrictEqual({ onOff: false, extra: 1 })
      expect(viewer.emit).not.toHaveBeenCalled()
    })

    it('reports an unavailable Homebridge process at once, without a retry', async () => {
      // no stub: the real sendMessage throws because no process is attached
      const send = vi.spyOn(ipc, 'sendMessage')
      const requester = { emit: vi.fn() }

      await svc.handleMatterControl(requester, { uniqueId: 'matter:abc', cluster: 'onOff', attributes: { onOff: true } })

      expect(send).toHaveBeenCalledTimes(1)
      expect(requester.emit).toHaveBeenCalledTimes(1)
      expect(requester.emit).toHaveBeenCalledWith('accessory-control-failure', 'The Homebridge Service Is Unavailable')
      expect(svc.logger.warn).toHaveBeenCalledWith('Matter IPC request \'accessoryControlResponse\' failed: The Homebridge Service Is Unavailable')
      expect(svc.logger.warn).not.toHaveBeenCalledWith('Matter IPC request \'accessoryControlResponse\' timed out, retrying...')
      expect(svc.matterRequests.size).toBe(0)
    })

    it('reports a timeout to the requester once both attempts expire', async () => {
      vi.useFakeTimers()
      const send = stubIpc(() => undefined)
      const requester = { emit: vi.fn() }

      const done = svc.handleMatterControl(requester, { uniqueId: 'matter:abc', cluster: 'onOff', attributes: { onOff: true } })
      await vi.advanceTimersByTimeAsync(20000)
      await done

      expect(send).toHaveBeenCalledTimes(2)
      expect(requester.emit).toHaveBeenCalledWith('accessory-control-failure', 'The Homebridge service did not respond')
    })

    // a part shares its parent's uuid, so the cache lookup must also match
    // the part id - otherwise the attributes land on the parent (first match)
    it('updates the controlled part, not its parent', async () => {
      const parent = cachedService({ uniqueId: 'matter:abc' })
      const part = cachedService({ uniqueId: 'matter:abc:2', partId: '2' })
      svc.matterAccessories = [parent, part]
      stubIpc((type, data) => ({ type: 'accessoryControlResponse', correlationId: data.correlationId, data: { success: true } }))

      await svc.handleMatterControl({ emit: vi.fn() }, { uniqueId: 'matter:abc:2', cluster: 'onOff', attributes: { onOff: true } })

      expect(part.clusters.onOff).toStrictEqual({ onOff: true, extra: 1 })
      expect(parent.clusters.onOff).toStrictEqual({ onOff: false, extra: 1 })
    })
  })

  describe('waitForMatterEvent', () => {
    it('does not retry a send failure, and rejects with that error', async () => {
      const sendRequest = vi.fn(() => {
        throw new Error('The Homebridge Service Is Unavailable')
      })

      await expect(svc.waitForMatterEvent('accessoryInfo', sendRequest)).rejects.toThrow('The Homebridge Service Is Unavailable')
      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(svc.logger.warn).toHaveBeenCalledTimes(1)
      expect(svc.logger.warn).toHaveBeenCalledWith('Matter IPC request \'accessoryInfo\' failed: The Homebridge Service Is Unavailable')
      expect(svc.logger.error).not.toHaveBeenCalled()
      expect(svc.matterRequests.size).toBe(0)
    })

    it('retries once after 10s and rejects with the timeout error after 20s', async () => {
      vi.useFakeTimers()
      const sendRequest = vi.fn()

      const result = svc.waitForMatterEvent('accessoryInfo', sendRequest)
      const outcome = result.then(() => 'resolved', (e: Error) => e)

      expect(sendRequest).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(9999)
      expect(sendRequest).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(sendRequest).toHaveBeenCalledTimes(2)
      expect(svc.logger.warn).toHaveBeenCalledWith('Matter IPC request \'accessoryInfo\' timed out, retrying...')
      // each attempt gets a fresh correlation id
      expect(sendRequest.mock.calls[0][0]).not.toBe(sendRequest.mock.calls[1][0])

      await vi.advanceTimersByTimeAsync(10000)
      const error = await outcome
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('The Homebridge service did not respond')
      expect(svc.logger.error).toHaveBeenCalledWith('Matter IPC request \'accessoryInfo\' failed after retry')
      expect(svc.matterRequests.size).toBe(0)
    })

    it('resolves with the data of a reply to the retry, and drops a late reply to the first attempt', async () => {
      vi.useFakeTimers()
      const sendRequest = vi.fn()

      const result = svc.waitForMatterEvent('accessoryInfo', sendRequest)
      await vi.advanceTimersByTimeAsync(10000)
      const [firstId] = sendRequest.mock.calls[0]
      const [retryId] = sendRequest.mock.calls[1]

      ipc.emit('matterEvent', { type: 'accessoryInfo', correlationId: firstId, data: { uuid: 'stale' } })
      ipc.emit('matterEvent', { type: 'accessoryInfo', correlationId: retryId, data: { uuid: 'fresh' } })

      await expect(result).resolves.toStrictEqual({ uuid: 'fresh' })
      expect(svc.logger.error).not.toHaveBeenCalled()
      expect(svc.matterRequests.size).toBe(0)
    })
  })
})
