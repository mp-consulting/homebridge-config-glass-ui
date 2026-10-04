import type { AddressInfo, Server } from 'node:net'

import { createServer, Socket } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { generatePin, generateUsername } from '../../src/core/hap-identity.js'
import { findFreePort, isPortInUse } from '../../src/core/net/port.js'
import { RE_PIN, RE_USERNAME } from '../../src/core/regex.constants.js'

/** Listen on a random free port on 127.0.0.1 */
async function listen(): Promise<{ server: Server, port: number }> {
  const server = createServer(socket => socket.destroy())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, port: (server.address() as AddressInfo).port }
}

function close(server: Server) {
  return new Promise<void>(resolve => server.close(() => resolve()))
}

describe('core/net/port', () => {
  const servers: Server[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close))
  })

  it('reports a port with a listener as in use, and as free once it closes', async () => {
    const { server, port } = await listen()
    servers.push(server)

    expect(await isPortInUse(port)).toBe(true)
    expect(await isPortInUse(port, '127.0.0.1')).toBe(true)

    await close(servers.pop())
    expect(await isPortInUse(port)).toBe(false)
  })

  it('rejects an invalid port', async () => {
    await expect(isPortInUse(-1)).rejects.toThrow('invalid port')
    await expect(isPortInUse(65536)).rejects.toThrow('invalid port')
    await expect(isPortInUse(1.5)).rejects.toThrow('invalid port')
    await expect(isPortInUse('80' as any)).rejects.toThrow('invalid port')
  })

  it('finds a free port inside the range', async () => {
    const port = await findFreePort(51000, 52000)
    expect(port).toBeGreaterThanOrEqual(51000)
    expect(port).toBeLessThanOrEqual(52000)
    expect(await isPortInUse(port)).toBe(false)
  })

  it('skips a port that is in use', async () => {
    const { server, port } = await listen()
    servers.push(server)

    // A two-port range with one taken: the free one is always picked
    const neighbour = port - 1
    if (await isPortInUse(neighbour)) {
      return // the neighbour is busy on this host; nothing to prove
    }
    const min = Math.min(port, neighbour)
    for (let i = 0; i < 10; i++) {
      expect(await findFreePort(min, min + 1)).toBe(neighbour)
    }
  })
})

describe('core/net/port isPortInUse when the probe meets its own port', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports a port the probe connected to itself on (Linux) as free', async () => {
    vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
      for (const [key, value] of Object.entries({ localPort: 51111, remotePort: 51111, localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' })) {
        Object.defineProperty(this, key, { value, configurable: true })
      }
      queueMicrotask(() => this.emit('connect'))
      return this
    } as any)

    expect(await isPortInUse(51111)).toBe(false)
  })

  it('reports EINVAL from a probe on its own port (macOS) as free', async () => {
    vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
      queueMicrotask(() => this.emit('error', Object.assign(new Error('connect EINVAL'), { code: 'EINVAL' })))
      return this
    } as any)

    expect(await isPortInUse(51111)).toBe(false)
  })

  it('still rejects on other connection errors', async () => {
    vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
      queueMicrotask(() => this.emit('error', Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' })))
      return this
    } as any)

    await expect(isPortInUse(51111, '10.255.255.1')).rejects.toThrow('EHOSTUNREACH')
  })
})

describe('core/hap-identity', () => {
  it('generates a HomeKit pin', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePin()).toMatch(RE_PIN)
    }
  })

  it('generates a bridge username', () => {
    for (let i = 0; i < 50; i++) {
      const username = generateUsername()
      expect(username).toMatch(RE_USERNAME)
      expect(username.startsWith('0E:')).toBe(true)
    }
  })
})
