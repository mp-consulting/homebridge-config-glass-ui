import { Buffer } from 'node:buffer'
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { outputFile, remove } from 'fs-extra'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { SslCertGeneratorService } from '../../src/core/ssl/ssl-cert-generator.service.js'
import { X509CertificateGenerator } from '../../src/core/ssl/x509.js'
import { testStoragePath } from '../storage-path.js'

const isPosix = process.platform !== 'win32'

describe('SslCertGeneratorService (e2e)', { timeout: 30_000 }, () => {
  const savedStoragePath = process.env.UIX_STORAGE_PATH
  const storage = resolve(testStoragePath, 'ssl')
  const certDir = join(storage, 'ssl-certs')
  const keyPath = join(certDir, 'private-key.pem')
  const certPath = join(certDir, 'certificate.pem')

  // The service reads UIX_STORAGE_PATH in its constructor
  const service = () => {
    process.env.UIX_STORAGE_PATH = storage
    return new SslCertGeneratorService()
  }

  /** A self-signed certificate that expired yesterday */
  const writeExpiredCertificate = async () => {
    const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 }
    const keys = await crypto.subtle.generateKey(alg, true, ['sign', 'verify'])
    const cert = await X509CertificateGenerator.createSelfSigned({
      serialNumber: '01',
      name: 'CN=localhost',
      notBefore: new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000),
      notAfter: new Date(Date.now() - 24 * 3600 * 1000),
      keys,
      signingAlgorithm: alg,
    })
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')
    await outputFile(keyPath, `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`)
    await outputFile(certPath, cert.toString('pem'))
  }

  beforeEach(async () => {
    await remove(storage)
  })

  afterAll(async () => {
    process.env.UIX_STORAGE_PATH = savedStoragePath
    await remove(storage)
  })

  it('generates a leaf certificate for the hostnames and IPs, valid until 2050', async () => {
    const { privateKey, certificate } = await service().generateOrLoadCertificate(['homebridge.local', '192.168.1.10', '::1'])

    const x509 = new X509Certificate(certificate)
    expect(x509.subject).toContain('CN=homebridge.local')
    expect(x509.subjectAltName).toContain('DNS:homebridge.local')
    expect(x509.subjectAltName).toContain('IP Address:192.168.1.10')
    expect(x509.ca).toBe(false)
    expect(new Date(x509.validTo).getUTCFullYear()).toBe(2050)
    expect(x509.checkPrivateKey(createPrivateKey(privateKey))).toBe(true)

    // Persisted
    expect(await readFile(certPath)).toEqual(certificate)
    expect(await readFile(keyPath)).toEqual(privateKey)
  })

  it.runIf(isPosix)('writes the key 0600 into a 0700 directory', async () => {
    await service().generateOrLoadCertificate()

    expect((await stat(keyPath)).mode & 0o777).toBe(0o600)
    expect((await stat(certDir)).mode & 0o777).toBe(0o700)
  })

  it('loads the existing certificate instead of generating a new one', async () => {
    const first = await service().generateOrLoadCertificate()
    const second = await service().generateOrLoadCertificate(['other.local'])

    expect(second.certificate).toEqual(first.certificate)
    expect(second.privateKey).toEqual(first.privateKey)
  })

  it('regenerates when only one of the two files exists', async () => {
    const first = await service().generateOrLoadCertificate()
    await remove(certPath)

    const second = await service().generateOrLoadCertificate()

    expect(second.privateKey).not.toEqual(first.privateKey)
    expect(new X509Certificate(second.certificate).subject).toContain('CN=localhost')
  })

  it('uses a different serial each time it generates', async () => {
    const a = new X509Certificate((await service().generateCertificate(['localhost'])).certificate)
    const b = new X509Certificate((await service().generateCertificate(['localhost'])).certificate)

    expect(a.serialNumber).not.toBe(b.serialNumber)
  })

  // A corrupt or expired certificate would otherwise be handed to the HTTPS
  // server as is: the UI fails to start, or serves an expired certificate
  it('regenerates a corrupt certificate', async () => {
    await outputFile(keyPath, 'garbage')
    await outputFile(certPath, 'garbage')

    const { certificate } = await service().generateOrLoadCertificate()

    expect(() => new X509Certificate(certificate)).not.toThrow()
  })

  it('regenerates an expired certificate', async () => {
    await writeExpiredCertificate()

    const { certificate } = await service().generateOrLoadCertificate()

    expect(new Date(new X509Certificate(certificate).validTo).getTime()).toBeGreaterThan(Date.now())
  })

  it('rejects when the certificate directory cannot be created', async () => {
    await outputFile(certDir, 'a file where the directory should be')

    await expect(service().generateOrLoadCertificate()).rejects.toThrow()
  })
})
