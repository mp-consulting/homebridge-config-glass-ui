import { Buffer } from 'node:buffer'
import { generateKeyPair, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { Injectable } from '@nestjs/common'
import { ensureDir } from 'fs-extra/esm'
import forge from 'node-forge'

import { Logger } from '../logger/logger.service.js'
import { RE_IPV4, RE_IPV6 } from '../regex.constants.js'

const generateKeyPairAsync = promisify(generateKeyPair)

interface SslCertificateData {
  privateKey: Buffer
  certificate: Buffer
}

/**
 * Service to generate self-signed SSL certificates dynamically
 */
@Injectable()
export class SslCertGeneratorService {
  private readonly logger = new Logger(SslCertGeneratorService.name)
  private readonly certDir: string
  private readonly privateKeyPath: string
  private readonly certificatePath: string

  constructor() {
    const storagePath = process.env.UIX_STORAGE_PATH || resolve(homedir(), '.homebridge')
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
        this.logger.log('Loaded existing self-signed certificate')
        return { privateKey, certificate }
      } catch (error) {
        this.logger.warn('Failed to load existing certificate, generating new one:', error.message)
      }
    }

    // Generate new certificate
    return this.generateCertificate(hostnames)
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

      // Generate a key pair natively and off the main thread - forge's pure JS
      // generator blocks the event loop for seconds on a Raspberry Pi
      const { privateKey } = await generateKeyPairAsync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })
      const forgePrivateKey = forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey
      const keys = {
        privateKey: forgePrivateKey,
        publicKey: forge.pki.setRsaPublicKey(forgePrivateKey.n, forgePrivateKey.e),
      }

      // Create a certificate
      const cert = forge.pki.createCertificate()
      cert.publicKey = keys.publicKey
      // A random positive serial: reusing one serial for the same issuer name
      // makes Firefox refuse a regenerated certificate outright
      // (SEC_ERROR_REUSED_ISSUER_AND_SERIAL)
      cert.serialNumber = `01${randomBytes(16).toString('hex')}`

      // Set validity period (25 years from now, until 2050)
      cert.validity.notBefore = new Date()
      cert.validity.notAfter = new Date('2050-01-01T00:00:00Z')

      // Set certificate attributes
      const attrs = [
        { name: 'commonName', value: hostnames[0] || 'localhost' },
        { name: 'countryName', value: 'US' },
        { shortName: 'ST', value: 'State' },
        { name: 'localityName', value: 'City' },
        { name: 'organizationName', value: 'Homebridge' },
        { shortName: 'OU', value: 'Homebridge Glass UI' },
      ]

      cert.setSubject(attrs)
      cert.setIssuer(attrs)

      // Add extensions
      const extensions = [
        {
          // A leaf certificate, not a CA: users are told to trust this
          // certificate, and a trusted CA key could sign certificates for
          // any domain
          name: 'basicConstraints',
          cA: false,
        },
        {
          name: 'keyUsage',
          digitalSignature: true,
          nonRepudiation: true,
          keyEncipherment: true,
          dataEncipherment: true,
        },
        {
          name: 'extKeyUsage',
          serverAuth: true,
          clientAuth: true,
        },
        {
          name: 'subjectAltName',
          altNames: hostnames.map((hostname) => {
            // Check if hostname is an IP address
            if (RE_IPV4.test(hostname) || RE_IPV6.test(hostname)) {
              return {
                type: 7, // IP
                ip: hostname,
              }
            } else {
              return {
                type: 2, // DNS
                value: hostname,
              }
            }
          }),
        },
      ]

      cert.setExtensions(extensions)

      // Self-sign certificate
      cert.sign(keys.privateKey, forge.md.sha256.create())

      // Convert to PEM format
      const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey)
      const certificatePem = forge.pki.certificateToPem(cert)

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
