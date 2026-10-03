import { createPrivateKey, X509Certificate } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { createSecureContext } from 'node:tls'

import Fastify from 'fastify'
import { writeJson } from 'fs-extra'
import { describe, expect, it, vi } from 'vitest'

import { getStartupConfig } from '../../src/core/config/config.startup.js'
import { parseTrustProxy } from '../../src/core/config/trust-proxy.js'
import { testStoragePath } from '../storage-path.js'

describe('getStartupConfig', () => {
  const configPath = resolve(testStoragePath, 'config.json')

  async function startupWith(ui: Record<string, unknown>) {
    process.env.UIX_CONFIG_PATH = configPath
    process.env.UIX_STORAGE_PATH = testStoragePath
    await writeJson(configPath, { bridge: {}, platforms: [{ platform: 'config', ...ui }] })
    return getStartupConfig()
  }

  it('records why HTTPS could not be enabled, instead of failing to start', async () => {
    const config = await startupWith({
      ssl: { key: resolve(testStoragePath, 'missing.key'), cert: resolve(testStoragePath, 'missing.crt') },
    })

    // Falls back to HTTP (so the UI stays reachable to fix it) - and says so
    expect(config.httpsOptions).toBeUndefined()
    expect(config.sslError).toMatch(/Could not load the configured certificate/)
  })

  it('generates a self-signed certificate under the storage path, then reuses it', async () => {
    await rm(resolve(testStoragePath, 'ssl-certs'), { recursive: true, force: true })
    const first = await startupWith({ ssl: { selfSigned: true, selfSignedHostnames: ['localhost', '127.0.0.1'] } })

    expect(first.sslError).toBeUndefined()
    const cert = new X509Certificate(first.httpsOptions.cert)
    expect(cert.subjectAltName).toBe('DNS:localhost, IP Address:127.0.0.1')
    expect(cert.checkPrivateKey(createPrivateKey(first.httpsOptions.key))).toBe(true)
    expect(() => createSecureContext({ key: first.httpsOptions.key, cert: first.httpsOptions.cert })).not.toThrow()
    expect(await readFile(resolve(testStoragePath, 'ssl-certs', 'certificate.pem'))).toEqual(first.httpsOptions.cert)

    const second = await startupWith({ ssl: { selfSigned: true } })
    expect(second.httpsOptions.cert).toEqual(first.httpsOptions.cert)
  })

  it('reports nothing when SSL is not configured', async () => {
    const config = await startupWith({})

    expect(config.sslError).toBeUndefined()
  })

  describe('trustProxy', () => {
    it('trusts no proxy headers by default', async () => {
      expect((await startupWith({})).trustProxy).toBeUndefined()
    })

    it('passes a list of proxy addresses through', async () => {
      expect((await startupWith({ trustProxy: ['127.0.0.1', '10.0.0.0/8'] })).trustProxy).toEqual(['127.0.0.1', '10.0.0.0/8'])
      expect((await startupWith({ trustProxy: 'loopback, fd00::/8' })).trustProxy).toEqual(['loopback', 'fd00::/8'])
    })

    it('ignores an invalid value as a whole instead of failing to start', async () => {
      expect((await startupWith({ trustProxy: ['127.0.0.1', 'not-an-ip'] })).trustProxy).toBeUndefined()
      expect((await startupWith({ trustProxy: true })).trustProxy).toBeUndefined()
    })
  })
})

describe('parseTrustProxy', () => {
  it.each([
    [['127.0.0.1'], ['127.0.0.1']],
    ['127.0.0.1,::1', ['127.0.0.1', '::1']],
    ['192.168.1.0/24 10.0.0.0/255.0.0.0', ['192.168.1.0/24', '10.0.0.0/255.0.0.0']],
    [['loopback', 'uniquelocal', 'linklocal'], ['loopback', 'uniquelocal', 'linklocal']],
    [['2001:db8::/32'], ['2001:db8::/32']],
  ])('accepts %j', (value, expected) => {
    const onInvalid = vi.fn()
    expect(parseTrustProxy(value, onInvalid)).toEqual(expected)
    expect(onInvalid).not.toHaveBeenCalled()
    // fastify (proxy-addr) accepts what passes, so a valid value cannot stop the server starting
    expect(() => Fastify({ trustProxy: expected })).not.toThrow()
  })

  it('makes the client address the forwarded one only for a trusted proxy', async () => {
    const app = Fastify({ trustProxy: parseTrustProxy(['127.0.0.1']) })
    app.get('/ip', async req => ({ ip: req.ip }))

    const viaProxy = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.7' } })
    const direct = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': '198.51.100.7' } })

    expect(viaProxy.json().ip).toBe('198.51.100.7')
    expect(direct.json().ip).toBe('203.0.113.9')
    await app.close()
  })

  it.each([undefined, null, '', false, []])('treats %j as not set', (value) => {
    const onInvalid = vi.fn()
    expect(parseTrustProxy(value, onInvalid)).toBeUndefined()
    expect(onInvalid).not.toHaveBeenCalled()
  })

  it.each([
    true,
    1,
    { a: 1 },
    'everyone',
    ['127.0.0.1', '*'],
    ['10.0.0.0/33'],
    ['::/129'],
    ['10.0.0.0/8/1'],
    ['fe80::1%en0'],
    [42],
  ])('refuses %j', (value) => {
    const onInvalid = vi.fn()
    expect(parseTrustProxy(value, onInvalid)).toBeUndefined()
    expect(onInvalid).toHaveBeenCalledOnce()
  })
})
