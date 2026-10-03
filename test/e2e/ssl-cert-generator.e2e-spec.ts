import { createPrivateKey, X509Certificate } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { outputFile, remove } from 'fs-extra'
import forge from 'node-forge'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { SslCertGeneratorService } from '../../src/core/ssl/ssl-cert-generator.service.js'
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
    const keys = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000)
    cert.validity.notAfter = new Date(Date.now() - 24 * 3600 * 1000)
    const attrs = [{ name: 'commonName', value: 'localhost' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey, forge.md.sha256.create())
    await outputFile(keyPath, forge.pki.privateKeyToPem(keys.privateKey))
    await outputFile(certPath, forge.pki.certificateToPem(cert))
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

  // BUG: generateOrLoadCertificate only checks that both files exist. A
  // corrupt or expired certificate is handed to the HTTPS server as is, and
  // never replaced, so the UI fails to start or serves an expired cert.
  it.fails('regenerates a corrupt certificate', async () => {
    await outputFile(keyPath, 'garbage')
    await outputFile(certPath, 'garbage')

    const { certificate } = await service().generateOrLoadCertificate()

    expect(() => new X509Certificate(certificate)).not.toThrow()
  })

  it.fails('regenerates an expired certificate', async () => {
    await writeExpiredCertificate()

    const { certificate } = await service().generateOrLoadCertificate()

    expect(new Date(new X509Certificate(certificate).validTo).getTime()).toBeGreaterThan(Date.now())
  })

  it('currently returns a corrupt or expired certificate unchanged', async () => {
    await outputFile(keyPath, 'garbage-key')
    await outputFile(certPath, 'garbage-cert')
    const corrupt = await service().generateOrLoadCertificate()
    expect(corrupt.certificate.toString()).toBe('garbage-cert')

    await writeExpiredCertificate()
    const expired = await service().generateOrLoadCertificate()
    expect(new Date(new X509Certificate(expired.certificate).validTo).getTime()).toBeLessThan(Date.now())
  })

  it('rejects when the certificate directory cannot be created', async () => {
    await outputFile(certDir, 'a file where the directory should be')

    await expect(service().generateOrLoadCertificate()).rejects.toThrow()
  })
})
