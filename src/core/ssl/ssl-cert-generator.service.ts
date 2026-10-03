import { Buffer } from 'node:buffer'
import { createPrivateKey, KeyObject, randomBytes, X509Certificate } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { ensureDir } from 'fs-extra/esm'

import { Logger } from '../logger/logger.service.js'
import { RE_IPV4, RE_IPV6 } from '../regex.constants.js'
import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from './x509.js'

interface SslCertificateData {
  privateKey: Buffer
  certificate: Buffer
}

const SIGNING_ALGORITHM = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
}

/**
 * Generates (or loads) the self-signed certificate under `<storage>/ssl-certs`.
 *
 * Not a Nest provider: the startup path (`getStartupConfig`) needs it before
 * the Nest app (and `ConfigService`) exist, so it takes the storage path from
 * its caller and only falls back to the environment.
 */
export class SslCertGeneratorService {
  private readonly logger = new Logger(SslCertGeneratorService.name)
  private readonly certDir: string
  private readonly privateKeyPath: string
  private readonly certificatePath: string

  constructor(storagePath: string = process.env.UIX_STORAGE_PATH || resolve(homedir(), '.homebridge')) {
    this.certDir = join(storagePath, 'ssl-certs')
    this.privateKeyPath = join(this.certDir, 'private-key.pem')
    this.certificatePath = join(this.certDir, 'certificate.pem')
  }

  /**
   * Generate or load a self-signed certificate
   * @param hostnames - Optional array of hostnames to include in the certificate
   */
  async generateOrLoadCertificate(hostnames: string[] = ['localhost']): Promise<SslCertificateData> {
    // Check if certificate already exists
    if (existsSync(this.privateKeyPath) && existsSync(this.certificatePath)) {
      try {
        const privateKey = await readFile(this.privateKeyPath)
        const certificate = await readFile(this.certificatePath)
        const problem = this.checkCertificate(privateKey, certificate)
        if (!problem) {
          this.logger.log('Loaded existing self-signed certificate')
          return { privateKey, certificate }
        }
        this.logger.warn(`Existing self-signed certificate ${problem}, generating a new one`)
      } catch (error) {
        this.logger.warn('Failed to load existing certificate, generating new one:', error.message)
      }
    }

    // Generate new certificate
    return this.generateCertificate(hostnames)
  }

  /**
   * Why a stored key and certificate can't be served (unreadable, mismatched
   * or expired), or undefined when they can
   */
  private checkCertificate(privateKey: Buffer, certificate: Buffer): string | undefined {
    let x509: X509Certificate
    try {
      x509 = new X509Certificate(certificate)
      if (!x509.checkPrivateKey(createPrivateKey(privateKey))) {
        return 'does not match its private key'
      }
    } catch {
      return 'could not be parsed'
    }
    if (new Date(x509.validTo).getTime() <= Date.now()) {
      return 'has expired'
    }
    return undefined
  }

  /**
   * Generate a new self-signed certificate
   * @param hostnames - Array of hostnames to include in the certificate
   */
  public async generateCertificate(hostnames: string[]): Promise<SslCertificateData> {
    this.logger.log('Generating self-signed certificate...')

    try {
      // Ensure the cert directory exists (owner only - it holds the private key)
      await ensureDir(this.certDir, 0o700)
      await chmod(this.certDir, 0o700).catch(() => {})

      // WebCrypto generates the key natively, off the main thread - a pure JS
      // generator blocks the event loop for seconds on a Raspberry Pi
      const keys = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ['sign', 'verify'])

      const commonName = hostnames[0] || 'localhost'
      const cert = await X509CertificateGenerator.createSelfSigned({
        // A random positive serial: reusing one serial for the same issuer name
        // makes Firefox refuse a regenerated certificate outright
        // (SEC_ERROR_REUSED_ISSUER_AND_SERIAL)
        serialNumber: `01${randomBytes(16).toString('hex')}`,
        name: [
          { CN: [commonName] },
          { C: ['US'] },
          { ST: ['State'] },
          { L: ['City'] },
          { O: ['Homebridge'] },
          { OU: ['Homebridge Glass UI'] },
        ],
        notBefore: new Date(),
        notAfter: new Date('2050-01-01T00:00:00Z'),
        keys,
        signingAlgorithm: SIGNING_ALGORITHM,
        extensions: [
          // A leaf certificate, not a CA: users are told to trust this
          // certificate, and a trusted CA key could sign certificates for
          // any domain
          new BasicConstraintsExtension(false, undefined, true),
          new KeyUsagesExtension(
            KeyUsageFlags.digitalSignature
            | KeyUsageFlags.nonRepudiation
            | KeyUsageFlags.keyEncipherment
            | KeyUsageFlags.dataEncipherment,
            true,
          ),
          new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth, ExtendedKeyUsage.clientAuth]),
          new SubjectAlternativeNameExtension(hostnames.map(hostname =>
            RE_IPV4.test(hostname) || RE_IPV6.test(hostname)
              ? { type: 'ip' as const, value: hostname }
              : { type: 'dns' as const, value: hostname },
          )),
        ],
      }, crypto)

      // Convert to PEM format
      const privateKeyPem = KeyObject.from(keys.privateKey).export({ type: 'pkcs8', format: 'pem' }) as string
      const certificatePem = cert.toString('pem')

      // Save to disk
      await writeFile(this.privateKeyPath, privateKeyPem, { encoding: 'utf8', mode: 0o600 })
      // `mode` only applies when the file is created - tighten an existing key too
      await chmod(this.privateKeyPath, 0o600).catch(() => {})
      await writeFile(this.certificatePath, certificatePem, 'utf8')

      this.logger.log(`Self-signed certificate generated successfully for: ${hostnames.join(', ')}`)

      return {
        privateKey: Buffer.from(privateKeyPem),
        certificate: Buffer.from(certificatePem),
      }
    } catch (error) {
      this.logger.error('Failed to generate self-signed certificate:', error)
      throw error
    }
  }
}
