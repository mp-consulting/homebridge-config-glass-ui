import type { Server } from 'node:https'
import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:https'
import { resolve } from 'node:path'

import { outputFile } from 'fs-extra'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SslCertGeneratorService } from '../../src/core/ssl/ssl-cert-generator.service.js'
import { createLoopbackFetch, loadLoopbackFetch, uiCertificatePath } from '../../src/modules/ai/ai-loopback.js'
import { testStoragePath } from '../storage-path.js'

/**
 * The fetch the Assistant's tools use for this server's own HTTPS: it must
 * trust the UI's self-signed certificate, and nothing else.
 */
describe('Assistant loopback fetch (e2e)', () => {
  let own: { privateKey: Buffer, certificate: Buffer }
  let other: { privateKey: Buffer, certificate: Buffer }
  let ownServer: Server
  let otherServer: Server

  async function listen(cert: { privateKey: Buffer, certificate: Buffer }): Promise<Server> {
    const server = createServer({ key: cert.privateKey, cert: cert.certificate }, (_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end('{"ok":true}')
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    return server
  }

  const url = (server: Server) => `https://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/check`

  beforeAll(async () => {
    const generator = new SslCertGeneratorService(resolve(testStoragePath, 'unused'))
    // The UI's default self-signed hostnames; the other certificate is also valid for 127.0.0.1
    own = await generator.generateCertificate(['localhost', '127.0.0.1'])
    other = await generator.generateCertificate(['other.local', '127.0.0.1'])
    ownServer = await listen(own)
    otherServer = await listen(other)
  })

  afterAll(async () => {
    await Promise.all([ownServer, otherServer].map(server => new Promise(done => server.close(done))))
  })

  it('reaches the server presenting the UI\'s own self-signed certificate', async () => {
    const res = await createLoopbackFetch(own.certificate)(url(ownServer))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('leaves global fetch verifying as usual', async () => {
    await expect(fetch(url(ownServer))).rejects.toThrow()
  })

  it('refuses any other certificate, even one for the same host', async () => {
    const error = await createLoopbackFetch(own.certificate)(url(otherServer)).catch(e => e)
    expect(error).toBeInstanceOf(Error)
    expect(String(error.cause?.message ?? error.message)).toMatch(/certificate/i)
  })

  it('pins the leaf: a certificate that validates but is not the UI\'s own is refused', async () => {
    // A chain file trusts both certificates, but only its first one is the UI's
    const loopbackFetch = createLoopbackFetch(Buffer.concat([own.certificate, Buffer.from('\n'), other.certificate]))

    expect((await loopbackFetch(url(ownServer))).status).toBe(200)
    const error = await loopbackFetch(url(otherServer)).catch(e => e)
    expect(error.cause?.message).toBe('The server at the loopback address did not present Glass UI\'s own certificate.')
  })

  it('does not care which hostname the certificate names', async () => {
    const generator = new SslCertGeneratorService(resolve(testStoragePath, 'unused'))
    const named = await generator.generateCertificate(['homebridge.local'])
    const server = await listen(named)
    try {
      expect((await createLoopbackFetch(named.certificate)(url(server))).status).toBe(200)
    } finally {
      await new Promise(done => server.close(done))
    }
  })

  describe('loading the certificate', () => {
    it('finds the self-signed certificate in storage, or the configured file', () => {
      expect(uiCertificatePath({ selfSigned: true }, '/storage')).toBe(resolve('/storage/ssl-certs/certificate.pem'))
      expect(uiCertificatePath({ key: '/k.pem', cert: '/c.pem' }, '/storage')).toBe('/c.pem')
      expect(uiCertificatePath({ pfx: '/bundle.pfx' }, '/storage')).toBeNull()
    })

    it('loads the self-signed certificate from storage', async () => {
      const storage = resolve(testStoragePath, 'loopback-storage')
      await outputFile(resolve(storage, 'ssl-certs', 'certificate.pem'), own.certificate)

      const loaded = await loadLoopbackFetch({ selfSigned: true }, storage)

      expect(loaded.error).toBeUndefined()
      expect((await loaded.fetch(url(ownServer))).status).toBe(200)
    })

    it('fails with a clear reason when the certificate cannot be read', async () => {
      const loaded = await loadLoopbackFetch({ key: '/nope/key.pem', cert: '/nope/cert.pem' }, testStoragePath)

      expect(loaded.error).toMatch(/cannot verify Glass UI's HTTPS certificate: .*ENOENT.*UIX_AI_LOCAL_URL/)
      const error = await loaded.fetch(url(ownServer)).catch(e => e)
      expect(error).toBeInstanceOf(TypeError)
      expect(error.cause.message).toBe(loaded.error)
    })

    it('fails with a clear reason for a PFX certificate', async () => {
      const loaded = await loadLoopbackFetch({ pfx: '/bundle.pfx' }, testStoragePath)
      expect(loaded.error).toMatch(/PFX/)
    })

    it('fails with a clear reason for a file that is not a certificate', async () => {
      const path = resolve(testStoragePath, 'not-a-cert.pem')
      await outputFile(path, 'hello')
      const loaded = await loadLoopbackFetch({ cert: path, key: path }, testStoragePath)
      expect(loaded.error).toMatch(/cannot verify Glass UI's HTTPS certificate/)
    })
  })
})
