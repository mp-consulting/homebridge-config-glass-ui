import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import process from 'node:process'

import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { WsException } from '@nestjs/websockets'
import { copy } from 'fs-extra'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { disconnectWsClientsWithToken, rememberWsUser } from '../../src/core/auth/guards/ws-auth.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { AccessoriesService } from '../../src/modules/accessories/accessories.service.js'
import { ChildBridgesGateway } from '../../src/modules/child-bridges/child-bridges.gateway.js'
import { ChildBridgesModule } from '../../src/modules/child-bridges/child-bridges.module.js'
import { ChildBridgesService } from '../../src/modules/child-bridges/child-bridges.service.js'
import { testStoragePath } from '../storage-path.js'
import { authorizeWsClient } from '../ws-client.js'

describe('ChildBridges (e2e)', () => {
  let app: NestFastifyApplication

  let childBridgesService: ChildBridgesService
  let childBridgesGateway: ChildBridgesGateway
  let homebridgeIpcService: HomebridgeIpcService
  let accessoriesService: AccessoriesService
  let client: EventEmitter

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    // Setup test config
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // Setup test auth file
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(process.env.UIX_STORAGE_PATH, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(process.env.UIX_STORAGE_PATH, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ChildBridgesModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())

    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    childBridgesService = app.get(ChildBridgesService)
    childBridgesGateway = app.get(ChildBridgesGateway)
    homebridgeIpcService = app.get(HomebridgeIpcService)
    accessoriesService = app.get(AccessoriesService)
  })

  beforeEach(async () => {
    if (client) {
      client.emit('disconnect')
    }

    vi.resetAllMocks()

    // Create client
    client = new EventEmitter()
    vi.spyOn(client, 'emit')
    vi.spyOn(client, 'on')
  })

  describe('ChildBridgesGateway', () => {
    it('should return child bridge metadata when IPC responds', async () => {
      const mockMetadata = [
        { status: 'ok', username: '0E:AA:BB:CC:DD:EE', name: 'Test Bridge', plugin: 'test-plugin', identifier: 'test', pin: '123-45-678', manuallyStopped: false },
      ]

      // Simulate IPC responding to the metadata request
      vi.spyOn(homebridgeIpcService, 'sendMessage').mockImplementation(() => {})
      vi.spyOn(childBridgesService, 'getChildBridges').mockResolvedValue(mockMetadata as any)

      const result = await childBridgesGateway.getChildBridges(authorizeWsClient({}))
      expect(result).toEqual(mockMetadata)
    })

    describe('pairing codes for non-admin users', () => {
      const nonAdmin = () => authorizeWsClient({}, { username: 'viewer', admin: false })
      const bridgeWithCodes = () => ({
        status: 'ok',
        username: '0E:AA:BB:CC:DD:EE',
        name: 'Test Bridge',
        plugin: 'test-plugin',
        identifier: 'test',
        pin: '123-45-678',
        setupUri: 'X-HM://0024SETUP',
        matterPin: '12345678901',
        matterSetupUri: 'MT:ABC',
        paired: false,
        manuallyStopped: false,
      })

      it('leaves the HomeKit and Matter codes out of the status reply', async () => {
        vi.spyOn(childBridgesService, 'getChildBridges').mockResolvedValue([bridgeWithCodes()] as any)

        const [bridge] = await childBridgesGateway.getChildBridges(nonAdmin()) as any[]

        expect(bridge).not.toHaveProperty('pin')
        expect(bridge).not.toHaveProperty('setupUri')
        expect(bridge).not.toHaveProperty('matterPin')
        expect(bridge).not.toHaveProperty('matterSetupUri')
        expect(bridge.name).toBe('Test Bridge')
        expect(bridge.paired).toBe(false)
      })

      it('treats a socket without a verified user as non-admin', async () => {
        vi.spyOn(childBridgesService, 'getChildBridges').mockResolvedValue([bridgeWithCodes()] as any)

        const [bridge] = await childBridgesGateway.getChildBridges({}) as any[]

        expect(bridge).not.toHaveProperty('pin')
      })

      it('still gives an admin the codes', async () => {
        vi.spyOn(childBridgesService, 'getChildBridges').mockResolvedValue([bridgeWithCodes()] as any)

        const [bridge] = await childBridgesGateway.getChildBridges(authorizeWsClient({})) as any[]

        expect(bridge.pin).toBe('123-45-678')
        expect(bridge.matterSetupUri).toBe('MT:ABC')
      })

      it('leaves the codes out of the pushed status updates, per client', async () => {
        const viewer = authorizeWsClient(new EventEmitter(), { username: 'viewer', admin: false })
        const admin = authorizeWsClient(new EventEmitter())
        const viewerEmit = vi.spyOn(viewer, 'emit')
        const adminEmit = vi.spyOn(admin, 'emit')

        await childBridgesService.watchChildBridgeStatus(viewer)
        await childBridgesService.watchChildBridgeStatus(admin)

        const update = bridgeWithCodes()
        homebridgeIpcService.emit('childBridgeStatusUpdate', update)

        const pushedToViewer = viewerEmit.mock.calls.find(([event]) => event === 'child-bridge-status-update')?.[1] as any
        const pushedToAdmin = adminEmit.mock.calls.find(([event]) => event === 'child-bridge-status-update')?.[1] as any
        expect(pushedToViewer.status).toBe('ok')
        expect(pushedToViewer).not.toHaveProperty('pin')
        expect(pushedToViewer).not.toHaveProperty('setupUri')
        expect(pushedToViewer).not.toHaveProperty('matterPin')
        expect(pushedToViewer).not.toHaveProperty('matterSetupUri')
        expect(pushedToAdmin.pin).toBe('123-45-678')
        expect(pushedToAdmin.matterPin).toBe('12345678901')
        // the shared IPC payload is not modified
        expect(update.pin).toBe('123-45-678')

        viewer.emit('disconnect')
        admin.emit('disconnect')
      })
    })

    it('should return empty array when IPC times out', async () => {
      vi.spyOn(childBridgesService, 'getChildBridges').mockResolvedValue([])

      const result = await childBridgesGateway.getChildBridges(authorizeWsClient({}))
      expect(result).toEqual([])
    })

    it('should return WsException when getChildBridges throws', async () => {
      vi.spyOn(childBridgesService, 'getChildBridges').mockRejectedValue(new Error('IPC error'))

      const result = await childBridgesGateway.getChildBridges(authorizeWsClient({}))
      expect(result).toBeInstanceOf(WsException)
      expect((result as WsException).getError()).toBe('IPC error')
    })

    it('should start watching child bridge status', async () => {
      vi.spyOn(childBridgesService, 'watchChildBridgeStatus').mockResolvedValue(undefined)

      await childBridgesGateway.watchChildBridgeStatus(client)
      expect(childBridgesService.watchChildBridgeStatus).toHaveBeenCalledWith(client)
    })

    it('keeps the WS auth registry\'s disconnect cleanup when the status stream ends', async () => {
      const user = { username: 'admin', admin: true }
      const socket = Object.assign(new EventEmitter(), { data: {} as any, disconnect: vi.fn() })
      rememberWsUser(socket as any, user as any, async () => user as any)
      socket.data.wsToken = 'child-bridges-listener-test-token'
      const registryListeners = socket.listenerCount('disconnect')

      await childBridgesService.watchChildBridgeStatus(socket)
      expect(socket.listenerCount('disconnect')).toBe(registryListeners + 1)

      // The UI closing the stream (`end`) detaches only the service's own pair
      socket.emit('end')
      expect(socket.listenerCount('end')).toBe(0)
      expect(socket.listenerCount('disconnect')).toBe(registryListeners)

      // ...so the registry still learns of the disconnect and forgets the
      // socket: a later logout with its token no longer reaches it
      socket.emit('disconnect')
      expect(socket.listenerCount('disconnect')).toBe(0)
      disconnectWsClientsWithToken('child-bridges-listener-test-token')
      expect(socket.disconnect).not.toHaveBeenCalled()
    })

    it('should restart a child bridge', async () => {
      vi.spyOn(childBridgesService, 'restartChildBridge').mockReturnValue({ ok: true })

      const result = await childBridgesGateway.restartChildBridge(client, '0EAA:BB:CC:DD:EE')
      expect(result).toEqual({ ok: true })
      expect(childBridgesService.restartChildBridge).toHaveBeenCalledWith('0EAA:BB:CC:DD:EE')
    })

    it('should return WsException when restartChildBridge throws', async () => {
      vi.spyOn(childBridgesService, 'restartChildBridge').mockImplementation(() => {
        throw new Error('restart failed')
      })

      const result = await childBridgesGateway.restartChildBridge(client, 'bad-id')
      expect(result).toBeInstanceOf(WsException)
      expect((result as WsException).getError()).toBe('restart failed')
    })

    it('should stop a child bridge', async () => {
      vi.spyOn(childBridgesService, 'stopChildBridge').mockReturnValue({ ok: true })

      const result = await childBridgesGateway.stopChildBridge(client, '0E:AA:BB:CC:DD:EE')
      expect(result).toEqual({ ok: true })
      expect(childBridgesService.stopChildBridge).toHaveBeenCalledWith('0E:AA:BB:CC:DD:EE')
    })

    it('should return WsException when stopChildBridge throws', async () => {
      vi.spyOn(childBridgesService, 'stopChildBridge').mockImplementation(() => {
        throw new Error('stop failed')
      })

      const result = await childBridgesGateway.stopChildBridge(client, 'bad-id')
      expect(result).toBeInstanceOf(WsException)
      expect((result as WsException).getError()).toBe('stop failed')
    })

    it('should start a child bridge', async () => {
      vi.spyOn(childBridgesService, 'startChildBridge').mockReturnValue({ ok: true })

      const result = await childBridgesGateway.startChildBridge(client, '0E:AA:BB:CC:DD:EE')
      expect(result).toEqual({ ok: true })
      expect(childBridgesService.startChildBridge).toHaveBeenCalledWith('0E:AA:BB:CC:DD:EE')
    })

    it('should return WsException when startChildBridge throws', async () => {
      vi.spyOn(childBridgesService, 'startChildBridge').mockImplementation(() => {
        throw new Error('start failed')
      })

      const result = await childBridgesGateway.startChildBridge(client, 'bad-id')
      expect(result).toBeInstanceOf(WsException)
      expect((result as WsException).getError()).toBe('start failed')
    })
  })

  describe('ChildBridgesService', () => {
    it('should return empty array when IPC requestResponse times out', async () => {
      // Don't set up a homebridge process, so requestResponse will fail
      const result = await childBridgesService.getChildBridges()
      expect(result).toEqual([])
    })

    it('should format 12-char deviceId with colons', () => {
      vi.spyOn(homebridgeIpcService, 'sendMessage').mockImplementation(() => {})
      vi.spyOn(accessoriesService, 'resetInstancePool').mockImplementation(() => {})

      const result = childBridgesService.stopStartRestartChildBridge('restartChildBridge', '0EAABBCCDDEE')

      expect(homebridgeIpcService.sendMessage).toHaveBeenCalledWith('restartChildBridge', '0E:AA:BB:CC:DD:EE')
      expect(result).toEqual({ ok: true })
    })

    it('should pass through already-formatted deviceId', () => {
      vi.spyOn(homebridgeIpcService, 'sendMessage').mockImplementation(() => {})
      vi.spyOn(accessoriesService, 'resetInstancePool').mockImplementation(() => {})

      const result = childBridgesService.stopStartRestartChildBridge('stopChildBridge', '0E:AA:BB:CC:DD:EE')

      expect(homebridgeIpcService.sendMessage).toHaveBeenCalledWith('stopChildBridge', '0E:AA:BB:CC:DD:EE')
      expect(result).toEqual({ ok: true })
    })

    it('should call resetInstancePool after a delay', async () => {
      vi.useFakeTimers()

      vi.spyOn(homebridgeIpcService, 'sendMessage').mockImplementation(() => {})
      vi.spyOn(accessoriesService, 'resetInstancePool').mockImplementation(() => {})

      childBridgesService.stopStartRestartChildBridge('restartChildBridge', '0E:AA:BB:CC:DD:EE')

      expect(accessoriesService.resetInstancePool).not.toHaveBeenCalled()

      vi.advanceTimersByTime(5000)

      expect(accessoriesService.resetInstancePool).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should delegate restartChildBridge to stopStartRestartChildBridge', () => {
      vi.spyOn(homebridgeIpcService, 'sendMessage').mockImplementation(() => {})
      vi.spyOn(accessoriesService, 'resetInstancePool').mockImplementation(() => {})

      const result = childBridgesService.restartChildBridge('0E:AA:BB:CC:DD:EE')

      expect(homebridgeIpcService.sendMessage).toHaveBeenCalledWith('restartChildBridge', '0E:AA:BB:CC:DD:EE')
      expect(result).toEqual({ ok: true })
    })

    it('should delegate stopChildBridge to stopStartRestartChildBridge', () => {
      vi.spyOn(homebridgeIpcService, 'sendMessage').mockImplementation(() => {})
      vi.spyOn(accessoriesService, 'resetInstancePool').mockImplementation(() => {})

      const result = childBridgesService.stopChildBridge('0E:AA:BB:CC:DD:EE')

      expect(homebridgeIpcService.sendMessage).toHaveBeenCalledWith('stopChildBridge', '0E:AA:BB:CC:DD:EE')
      expect(result).toEqual({ ok: true })
    })

    it('should delegate startChildBridge to stopStartRestartChildBridge', () => {
      vi.spyOn(homebridgeIpcService, 'sendMessage').mockImplementation(() => {})
      vi.spyOn(accessoriesService, 'resetInstancePool').mockImplementation(() => {})

      const result = childBridgesService.startChildBridge('0E:AA:BB:CC:DD:EE')

      expect(homebridgeIpcService.sendMessage).toHaveBeenCalledWith('startChildBridge', '0E:AA:BB:CC:DD:EE')
      expect(result).toEqual({ ok: true })
    })

    it('should watch child bridge status and forward updates to client', async () => {
      authorizeWsClient(client)
      await childBridgesService.watchChildBridgeStatus(client)

      const statusData = { status: 'ok', username: '0E:AA:BB:CC:DD:EE' }
      homebridgeIpcService.emit('childBridgeStatusUpdate', statusData)

      expect(client.emit).toHaveBeenCalledWith('child-bridge-status-update', statusData)
    })

    it('should clean up listeners on client disconnect', async () => {
      // The health tracker's own listener is always there
      const base = homebridgeIpcService.listenerCount('childBridgeStatusUpdate')
      await childBridgesService.watchChildBridgeStatus(client)

      const initialIpcListenerCount = homebridgeIpcService.listenerCount('childBridgeStatusUpdate')
      expect(initialIpcListenerCount).toBe(base + 1)

      // Simulate disconnect
      client.emit('disconnect')

      expect(homebridgeIpcService.listenerCount('childBridgeStatusUpdate')).toBe(base)
    })

    it('does not stack a second listener on a repeat watch from the same socket', async () => {
      // The health tracker's own listener is always there
      const base = homebridgeIpcService.listenerCount('childBridgeStatusUpdate')
      await childBridgesService.watchChildBridgeStatus(client)
      await childBridgesService.watchChildBridgeStatus(client)

      expect(homebridgeIpcService.listenerCount('childBridgeStatusUpdate')).toBe(base + 1)
      const statusData = { status: 'ok', username: '0E:AA:BB:CC:DD:EE' }
      homebridgeIpcService.emit('childBridgeStatusUpdate', statusData)
      expect(vi.mocked(client.emit).mock.calls.filter(call => call[0] === 'child-bridge-status-update')).toHaveLength(1)

      // after a disconnect the socket may watch afresh
      client.emit('disconnect')
      expect(homebridgeIpcService.listenerCount('childBridgeStatusUpdate')).toBe(base)
      await childBridgesService.watchChildBridgeStatus(client)
      expect(homebridgeIpcService.listenerCount('childBridgeStatusUpdate')).toBe(base + 1)
      client.emit('disconnect')
    })

    it('should clean up listeners on client end', async () => {
      // The health tracker's own listener is always there
      const base = homebridgeIpcService.listenerCount('childBridgeStatusUpdate')
      await childBridgesService.watchChildBridgeStatus(client)

      expect(homebridgeIpcService.listenerCount('childBridgeStatusUpdate')).toBe(base + 1)

      // Simulate end
      client.emit('end')

      expect(homebridgeIpcService.listenerCount('childBridgeStatusUpdate')).toBe(base)
    })
  })

  afterAll(async () => {
    await app.close()
  })
})
