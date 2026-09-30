import { EventEmitter } from 'node:events'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAuthorizedRunner, isWsClientAuthorized } from '../../src/core/auth/guards/ws-auth.js'
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

  it('allows the Angular dev server in development only', async () => {
    process.env.UIX_DEVELOPMENT = '1'
    expect(await allows('http://homebridge.local:4200')).toBe(true)
    expect(await allows('http://homebridge.local:9999')).toBe(false)
  })
})
