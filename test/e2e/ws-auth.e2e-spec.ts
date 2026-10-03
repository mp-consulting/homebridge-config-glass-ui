import { EventEmitter } from 'node:events'
import process from 'node:process'

import jwt from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authorizeWsGuardClient,
  createAuthorizedRunner,
  disconnectWsClientsWithToken,
  isWsClientAuthorized,
  revalidateWsClients,
  WS_REAUTH_EVENT,
  WS_TOKEN_GRACE_SECONDS,
} from '../../src/core/auth/guards/ws-auth.js'
import { extractWsToken } from '../../src/core/auth/guards/ws-token.js'
import { devServerCorsConfig } from '../../src/core/cors.config.js'
import { authorizeWsClient } from '../ws-client.js'

describe('websocket re-authorisation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs actions synchronously while the last check is fresh', () => {
    const client = authorizeWsClient(new EventEmitter())
    const action = vi.fn()

    createAuthorizedRunner(client, { admin: true })(action)

    expect(action).toHaveBeenCalledOnce()
    expect(client.data.revalidateUser).not.toHaveBeenCalled()
  })

  it('re-checks the user once the last check is stale, keeping actions in order', async () => {
    vi.useFakeTimers()
    const client = authorizeWsClient(new EventEmitter())
    const run = createAuthorizedRunner(client, { admin: true })
    const written: string[] = []

    vi.advanceTimersByTime(6000)
    for (const key of ['a', 'b', 'c']) {
      run(() => written.push(key))
    }

    expect(written).toEqual([])
    await vi.runAllTimersAsync()
    expect(written).toEqual(['a', 'b', 'c'])
    expect(client.data.revalidateUser).toHaveBeenCalledOnce()
  })

  it('drops the action and disconnects a revoked user', async () => {
    vi.useFakeTimers()
    const client = authorizeWsClient(new EventEmitter())
    client.data.revalidateUser.mockRejectedValue(new Error('User no longer valid'))
    const action = vi.fn()

    vi.advanceTimersByTime(6000)
    createAuthorizedRunner(client, { admin: true })(action)
    await vi.runAllTimersAsync()

    expect(action).not.toHaveBeenCalled()
    expect(client.disconnect).toHaveBeenCalledWith(true)
  })

  it('refuses a demoted user where admin is required', async () => {
    const client = authorizeWsClient(new EventEmitter(), { username: 'bob', admin: false })

    expect(await isWsClientAuthorized(client, { admin: true })).toBe(false)
    expect(client.disconnect).toHaveBeenCalledWith(true)
  })

  it('refuses a socket that never passed a guard', async () => {
    const client = Object.assign(new EventEmitter(), { data: {}, disconnect: vi.fn() })

    expect(await isWsClientAuthorized(client, { admin: false })).toBe(false)
  })
})

describe('websocket sessions', () => {
  const secretKey = 'test-secret'
  const configService = { secrets: { secretKey }, instanceId: 'instance', setupWizardComplete: true } as any
  let users: Record<string, { admin: boolean, sessionVersion: number }>
  const authService = {
    validateUser: vi.fn(async (payload: any) => {
      // As AuthService: a service token has no account behind it
      if (typeof payload.service === 'string') {
        return payload
      }
      const user = users[payload.username]
      return user && user.admin === payload.admin && user.sessionVersion === payload.sessionVersion ? payload : null
    }),
  } as any

  const sign = (username: string, options: { admin?: boolean, expiresIn?: number, sessionVersion?: number } = {}) => jwt.sign(
    { username, admin: options.admin ?? true, instanceId: 'instance', sessionVersion: options.sessionVersion ?? 1 },
    secretKey,
    { expiresIn: options.expiresIn ?? 3600 },
  )

  const socket = (token: string) => Object.assign(new EventEmitter(), {
    handshake: { auth: { token } },
    data: {} as any,
    disconnect: vi.fn(),
  })

  const opened: EventEmitter[] = []
  async function connect(token: string, options: { admin?: () => boolean } = {}) {
    const client = socket(token)
    opened.push(client)
    await authorizeWsGuardClient(client, configService, authService, options)
    return client
  }

  const reauth = (client: EventEmitter, token: string) => new Promise<any>((resolve) => {
    client.emit(WS_REAUTH_EVENT, { token }, resolve)
  })

  beforeEach(() => {
    users = { admin: { admin: true, sessionVersion: 1 }, bob: { admin: false, sessionVersion: 1 } }
  })

  afterEach(() => {
    // Forget this test's sockets, as a real disconnect would
    for (const client of opened.splice(0)) {
      client.emit('disconnect')
    }
    vi.useRealTimers()
  })

  it('cuts every socket of a revoked user at once, leaving others open', async () => {
    const admin = await connect(sign('admin'))
    const bob = await connect(sign('bob', { admin: false }))

    users.admin.sessionVersion = 2 // password change, demotion or logout everywhere
    await revalidateWsClients()

    expect(admin.disconnect).toHaveBeenCalledWith(true)
    expect(bob.disconnect).not.toHaveBeenCalled()
  })

  it('cuts a non-admin from a namespace that has become admin-only', async () => {
    let restricted = false
    const bob = await connect(sign('bob', { admin: false }), { admin: () => restricted })

    await revalidateWsClients()
    expect(bob.disconnect).not.toHaveBeenCalled()

    restricted = true
    await revalidateWsClients()
    expect(bob.disconnect).toHaveBeenCalledWith(true)
  })

  it('does not drop a non-admin\'s socket for trying one admin-only message', async () => {
    const bob = socket(sign('bob', { admin: false }))
    opened.push(bob)
    await authorizeWsGuardClient(bob, configService, authService, { admin: () => true })

    await revalidateWsClients()
    expect(bob.disconnect).not.toHaveBeenCalled()
  })

  it('closes a socket whose token expired more than the grace period ago', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const client = await connect(sign('admin', { expiresIn: 60 }))

    vi.setSystemTime(Date.now() + (60 + WS_TOKEN_GRACE_SECONDS - 10) * 1000)
    expect(await isWsClientAuthorized(client, { admin: false })).toBe(true)

    vi.setSystemTime(Date.now() + 20 * 1000)
    expect(await isWsClientAuthorized(client, { admin: false })).toBe(false)
    expect(client.disconnect).toHaveBeenCalledWith(true)
  })

  it('keeps a plugin\'s service-token socket open past the token\'s expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // Minted by the plugin itself from the signing key (see validateServiceToken)
    const token = jwt.sign({ service: 'homebridge-example', admin: true, instanceId: 'instance' }, secretKey, { expiresIn: 300 })
    const client = await connect(token)

    vi.setSystemTime(Date.now() + (300 + WS_TOKEN_GRACE_SECONDS + 600) * 1000)
    expect(await isWsClientAuthorized(client, { admin: false })).toBe(true)
    expect(client.disconnect).not.toHaveBeenCalled()
  })

  it('keeps a long-lived socket open while its browser keeps refreshing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const client = await connect(sign('admin', { expiresIn: 60 }))

    vi.setSystemTime(Date.now() + 50 * 1000)
    expect(await reauth(client, sign('admin', { expiresIn: 60 }))).toEqual({ ok: true })

    // Long past the first token's expiry and grace
    vi.setSystemTime(Date.now() + (55 + WS_TOKEN_GRACE_SECONDS) * 1000)
    expect(await reauth(client, sign('admin', { expiresIn: 3600 }))).toEqual({ ok: true })
    vi.setSystemTime(Date.now() + 1800 * 1000)
    expect(await isWsClientAuthorized(client, { admin: false })).toBe(true)
  })

  it('refuses to re-authenticate with an expired, foreign or another user\'s token', async () => {
    const client = await connect(sign('admin'))

    expect(await reauth(client, sign('admin', { expiresIn: -10 }))).toEqual({ error: 'Unauthorized' })
    expect(await reauth(client, jwt.sign({ username: 'admin', admin: true, instanceId: 'instance', sessionVersion: 1 }, 'other'))).toEqual({ error: 'Unauthorized' })
    expect(await reauth(client, sign('bob', { admin: false }))).toEqual({ error: 'Unauthorized' })
    expect(client.data.user.username).toBe('admin')
  })

  it('ignores a token sent in the handshake query string', async () => {
    // Query strings end up in proxy and access logs - only the `auth` payload counts
    const token = sign('admin')
    expect(extractWsToken({ query: { token } })).toBeUndefined()
    expect(extractWsToken({ auth: { token }, query: { token: 'other' } })).toBe(token)

    const client = Object.assign(new EventEmitter(), {
      handshake: { auth: {}, query: { token } },
      data: {} as any,
      disconnect: vi.fn(),
    })
    await expect(authorizeWsGuardClient(client, configService, authService)).rejects.toThrow()
    expect(client.data.user).toBeUndefined()
  })

  it('ends the sockets of a browser that logged out locally, and only those', async () => {
    const token = sign('admin')
    const here = await connect(token)
    const elsewhere = await connect(sign('admin', { expiresIn: 7200 }))

    disconnectWsClientsWithToken(token)

    expect(here.disconnect).toHaveBeenCalledWith(true)
    expect(elsewhere.disconnect).not.toHaveBeenCalled()
  })

  it('matches a local logout against the refreshed token a socket was handed', async () => {
    const client = await connect(sign('admin'))
    const refreshed = sign('admin', { expiresIn: 7200 })
    await reauth(client, refreshed)

    disconnectWsClientsWithToken(refreshed)

    expect(client.disconnect).toHaveBeenCalledWith(true)
  })
})

describe('cors', () => {
  const allows = (origin: string | undefined) => new Promise((resolve) => {
    devServerCorsConfig.origin(origin, (_error, allow) => resolve(allow))
  })

  afterEach(() => {
    delete process.env.UIX_DEVELOPMENT
  })

  it('allows requests without an Origin header', async () => {
    expect(await allows(undefined)).toBe(true)
  })

  it('refuses every cross-origin request in production, even on a dev-server port', async () => {
    delete process.env.UIX_DEVELOPMENT
    expect(await allows('http://attacker.example:8080')).toBe(false)
    expect(await allows('http://homebridge.local:4200')).toBe(false)
  })

  it('allows the UI dev server in development only', async () => {
    process.env.UIX_DEVELOPMENT = '1'
    expect(await allows('http://homebridge.local:4200')).toBe(true)
    expect(await allows('http://homebridge.local:9999')).toBe(false)
  })
})
