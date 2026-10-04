import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { AddressInfo } from 'node:net'

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'

import { FastifyAdapter } from '@nestjs/platform-fastify'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { Test } from '@nestjs/testing'
import { GATEWAY_METADATA, MESSAGE_MAPPING_METADATA, MESSAGE_METADATA } from '@nestjs/websockets/constants.js'
import { copy, writeJson } from 'fs-extra'
import jwt from 'jsonwebtoken'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppGateway } from '../../src/app.gateway.js'
import { AuthModule } from '../../src/core/auth/auth.module.js'
import { WsAdminGuard } from '../../src/core/auth/guards/ws-admin-guard.js'
import { WsLogGuard } from '../../src/core/auth/guards/ws-log.guard.js'
import { WsGuard } from '../../src/core/auth/guards/ws.guard.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { red } from '../../src/core/logger/colors.js'
import { AccessoriesGateway } from '../../src/modules/accessories/accessories.gateway.js'
import { AiGateway } from '../../src/modules/ai/ai.gateway.js'
import { BackupGateway } from '../../src/modules/backup/backup.gateway.js'
import { ChildBridgesGateway } from '../../src/modules/child-bridges/child-bridges.gateway.js'
import { PluginsSettingsUiGateway } from '../../src/modules/custom-plugins/plugins-settings-ui/plugins-settings-ui.gateway.js'
import { LogGateway } from '../../src/modules/log/log.gateway.js'
import { TerminalGateway } from '../../src/modules/platform-tools/terminal/terminal.gateway.js'
import { PluginsGateway } from '../../src/modules/plugins/plugins.gateway.js'
import { PluginsModule } from '../../src/modules/plugins/plugins.module.js'
import { PluginsService } from '../../src/modules/plugins/plugins.service.js'
import { StatusGateway } from '../../src/modules/status/status.gateway.js'
import { UpdateAllGateway } from '../../src/modules/update-all/update-all.gateway.js'
// The server package does not depend on socket.io-client; the UI does (same
// 4.x as the server's socket.io), and CI installs both packages before tests.
// eslint-disable-next-line antfu/no-import-node-modules-by-path
import { io } from '../../ui/node_modules/socket.io-client/build/esm/index.js'
import { testStoragePath } from '../storage-path.js'

const GUARDS_METADATA = '__guards__'

interface GatewayExpectation {
  file: string
  gateway: any
  /** Guards applied with @UseGuards on the class, in order. */
  classGuards: any[]
  /** Every @SubscribeMessage handler: message name -> [method name, method-level guards]. */
  messages: Record<string, [string, any[]]>
}

/**
 * Every websocket gateway and who may call each of its messages. A gateway or
 * message added without an entry here fails the suite, so the access level of
 * new socket surface is always a deliberate, reviewed choice.
 */
const GATEWAYS: GatewayExpectation[] = [
  {
    file: 'src/app.gateway.ts',
    gateway: AppGateway,
    classGuards: [WsGuard],
    messages: {},
  },
  {
    file: 'src/modules/accessories/accessories.gateway.ts',
    gateway: AccessoriesGateway,
    classGuards: [WsGuard],
    messages: {
      'get-accessories': ['connect', []],
      'get-layout': ['getAccessoryLayout', []],
      'save-layout': ['saveAccessoryLayout', []],
    },
  },
  {
    // Any user may chat (its tools follow the user's rights); diagnose-logs
    // and plugin-config check for an administrator in the handler
    file: 'src/modules/ai/ai.gateway.ts',
    gateway: AiGateway,
    classGuards: [WsGuard],
    messages: {
      'chat': ['chat', []],
      'diagnose-logs': ['diagnoseLogs', []],
      'plugin-config': ['pluginConfig', []],
      'cancel': ['cancel', []],
      'confirm': ['confirm', []],
    },
  },
  {
    file: 'src/modules/backup/backup.gateway.ts',
    gateway: BackupGateway,
    classGuards: [WsAdminGuard],
    messages: {
      'do-restore': ['doRestore', []],
      'do-restore-hbfx': ['doRestoreHbfx', []],
    },
  },
  {
    file: 'src/modules/child-bridges/child-bridges.gateway.ts',
    gateway: ChildBridgesGateway,
    classGuards: [WsGuard],
    messages: {
      'get-homebridge-child-bridge-status': ['getChildBridges', []],
      'monitor-child-bridge-status': ['watchChildBridgeStatus', []],
      'restart-child-bridge': ['restartChildBridge', [WsAdminGuard]],
      'stop-child-bridge': ['stopChildBridge', [WsAdminGuard]],
      'start-child-bridge': ['startChildBridge', [WsAdminGuard]],
    },
  },
  {
    file: 'src/modules/custom-plugins/plugins-settings-ui/plugins-settings-ui.gateway.ts',
    gateway: PluginsSettingsUiGateway,
    classGuards: [WsAdminGuard],
    messages: {
      start: ['startCustomUiHandler', []],
    },
  },
  {
    file: 'src/modules/log/log.gateway.ts',
    gateway: LogGateway,
    classGuards: [WsLogGuard],
    messages: {
      'tail-log': ['connect', []],
    },
  },
  {
    file: 'src/modules/platform-tools/terminal/terminal.gateway.ts',
    gateway: TerminalGateway,
    classGuards: [WsAdminGuard],
    messages: {
      'start-session': ['startTerminalSession', []],
      'destroy-persistent-session': ['destroyPersistentSession', []],
      'check-persistent-session': ['checkPersistentSession', []],
    },
  },
  {
    file: 'src/modules/plugins/plugins.gateway.ts',
    gateway: PluginsGateway,
    classGuards: [WsAdminGuard],
    messages: {
      'install': ['installPlugin', []],
      'uninstall': ['uninstallPlugin', []],
      'update': ['updatePlugin', []],
      'homebridge-update': ['homebridgeUpdate', []],
    },
  },
  {
    file: 'src/modules/status/status.gateway.ts',
    gateway: StatusGateway,
    classGuards: [WsGuard],
    messages: {
      'get-dashboard-layout': ['getDashboardLayout', []],
      'get-dashboard-init': ['getDashboardInit', []],
      'set-dashboard-layout': ['setDashboardLayout', [WsAdminGuard]],
      'homebridge-version-check': ['homebridgeVersionCheck', []],
      'homebridge-ui-version-check': ['homebridgeUiVersionCheck', []],
      'npm-version-check': ['npmVersionCheck', []],
      'docker-version-check': ['dockerVersionCheck', []],
      'nodejs-version-check': ['nodeVersionCheck', []],
      'clear-nodejs-version-cache': ['clearNodeJsVersionCache', []],
      'get-out-of-date-plugins': ['getOutOfDatePlugins', []],
      'get-version-overview': ['getVersionOverview', []],
      'get-homebridge-server-info': ['getHomebridgeServerInfo', []],
      'get-server-cpu-info': ['getServerCpuInfo', []],
      'get-server-memory-info': ['getServerMemoryInfo', []],
      'get-server-network-info': ['getServerNetworkInfo', []],
      'get-server-uptime-info': ['getServerUptimeInfo', []],
      'get-homebridge-pairing-pin': ['getHomebridgePairingPin', []],
      'get-homebridge-status': ['getHomebridgeStatus', []],
      'monitor-server-status': ['serverStatus', []],
      'get-raspberry-pi-throttled-status': ['getRaspberryPiThrottledStatus', []],
    },
  },
  {
    file: 'src/modules/update-all/update-all.gateway.ts',
    gateway: UpdateAllGateway,
    classGuards: [WsAdminGuard],
    messages: {
      subscribe: ['subscribe', []],
    },
  },
]

const repoRoot = resolve(__dirname, '../..')

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listTsFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

/** Every class in src/ that declares `@WebSocketGateway`, as "file#ClassName". */
function discoverGateways(): string[] {
  return listTsFiles(join(repoRoot, 'src')).flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    if (!/@WebSocketGateway\(/.test(source)) {
      return []
    }
    const classes = [...source.matchAll(/@WebSocketGateway\([\s\S]*?export class (\w+)/g)].map(m => m[1])
    expect(classes, `could not find the gateway class in ${path}`).not.toEqual([])
    return classes.map(name => `${relative(repoRoot, path)}#${name}`)
  }).sort()
}

/** The @SubscribeMessage handlers Nest will register for a gateway: message -> method name. */
function subscribedMessages(gateway: any): Record<string, string> {
  const result: Record<string, string> = {}
  for (const method of Object.getOwnPropertyNames(gateway.prototype)) {
    const handler = gateway.prototype[method]
    if (method !== 'constructor' && typeof handler === 'function' && Reflect.getMetadata(MESSAGE_MAPPING_METADATA, handler)) {
      result[Reflect.getMetadata(MESSAGE_METADATA, handler)] = method
    }
  }
  return result
}

describe('websocket gateway guards', () => {
  it('covers every @WebSocketGateway class in src/', () => {
    const expected = GATEWAYS.map(g => `${g.file}#${g.gateway.name}`).sort()
    expect(discoverGateways()).toEqual(expected)
  })

  describe.each(GATEWAYS.map(g => [g.gateway.name, g] as const))('%s', (_name, { gateway, classGuards, messages }) => {
    it('is a gateway', () => {
      expect(Reflect.getMetadata(GATEWAY_METADATA, gateway)).toBe(true)
    })

    it('has the expected class-level guards', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, gateway)).toEqual(classGuards)
    })

    it('subscribes exactly the expected messages', () => {
      const expected = Object.fromEntries(Object.entries(messages).map(([message, [method]]) => [message, method]))
      expect(subscribedMessages(gateway)).toEqual(expected)
    })

    it.each(Object.entries(messages))('%s has the expected handler-level guards', (_message, [method, handlerGuards]) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, gateway.prototype[method]) ?? []).toEqual(handlerGuards)
    })
  })
})

describe('admin-only websocket message over a real socket', { timeout: 15_000 }, () => {
  let app: NestFastifyApplication
  let url: string
  let pluginsService: PluginsService
  let userToken: string
  let adminToken: string
  const sockets: any[] = []

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = repoRoot
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    process.env.UIX_CUSTOM_PLUGIN_PATH = resolve(testStoragePath, 'plugins/node_modules')

    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))
    // Tokens are minted directly below, so the hashes are never checked
    await writeJson(resolve(testStoragePath, 'auth.json'), [
      { id: 1, username: 'admin', name: 'Administrator', hashedPassword: 'x', salt: 'x', admin: true },
      { id: 2, username: 'bob', name: 'Bob', hashedPassword: 'x', salt: 'x', admin: false },
    ])

    const moduleFixture = await Test.createTestingModule({
      imports: [PluginsModule, AuthModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useWebSocketAdapter(new IoAdapter(app))
    await app.listen(0, '127.0.0.1')
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`

    const configService = app.get(ConfigService)
    configService.setupWizardComplete = true
    const sign = (user: object) => jwt.sign({ ...user, instanceId: configService.instanceId }, configService.secrets.secretKey, { expiresIn: '1h' })
    userToken = sign({ username: 'bob', name: 'Bob', admin: false })
    adminToken = sign({ username: 'admin', name: 'Administrator', admin: true })

    pluginsService = app.get(PluginsService)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    sockets.forEach(s => s.close())
    await app?.close()
  })

  function connect(token: string) {
    const socket = io(`${url}/plugins`, { auth: { token }, transports: ['websocket'], reconnection: false })
    sockets.push(socket)
    return socket
  }

  /** Connect, send one message, and collect what comes back on `listenFor`. */
  async function emitAndCollect(socket: any, event: string, payload: unknown, listenFor = 'exception') {
    const received: unknown[] = []
    socket.on(listenFor, (e: unknown) => received.push(e))
    await new Promise<void>((resolveConnect, reject) => {
      socket.on('connect', () => resolveConnect())
      socket.on('connect_error', reject)
    })
    socket.emit(event, payload)
    await vi.waitFor(() => expect(received).not.toEqual([]))
    return received
  }

  it('refuses a non-admin user calling plugins `install`, leaving the socket open', async () => {
    const install = vi.spyOn(pluginsService, 'managePlugin')
    const socket = connect(userToken)

    const exceptions = await emitAndCollect(socket, 'install', { name: 'homebridge-mock-plugin' })

    expect(exceptions).toEqual([{
      status: 'error',
      message: 'Forbidden resource',
      cause: { pattern: 'install', data: { name: 'homebridge-mock-plugin' } },
    }])
    expect(install).not.toHaveBeenCalled()
    // A valid but under-privileged user is refused per message, not disconnected
    expect(socket.connected).toBe(true)
  })

  it('reaches the handler for an admin (the refusal above is the guard, not the payload)', async () => {
    const install = vi.spyOn(pluginsService, 'managePlugin').mockRejectedValue(new Error('stubbed install'))
    const socket = connect(adminToken)

    const stdout = await emitAndCollect(socket, 'install', { name: 'homebridge-mock-plugin' }, 'stdout')

    expect(install).toHaveBeenCalledExactlyOnceWith('install', { name: 'homebridge-mock-plugin' }, expect.anything())
    expect(stdout).toEqual([`\n\r${red('Error: stubbed install')}\n\r`])
  })

  it('disconnects a socket with no token at the first guarded message', async () => {
    const install = vi.spyOn(pluginsService, 'managePlugin')
    const socket = connect('')
    const exceptions: unknown[] = []
    socket.on('exception', (e: unknown) => exceptions.push(e))
    const disconnected = new Promise<string>(r => socket.on('disconnect', r))
    await new Promise<void>(r => socket.on('connect', () => r()))

    socket.emit('install', { name: 'homebridge-mock-plugin' })

    // The guard disconnects before Nest can deliver its 'Unauthorized' exception
    expect(await disconnected).toBe('io server disconnect')
    expect(exceptions).toEqual([])
    expect(install).not.toHaveBeenCalled()
  })
})
