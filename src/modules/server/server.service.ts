import type { MultipartFile, MultipartValue } from '@fastify/multipart'
import type { FastifyRequest } from 'fastify'

import { Buffer } from 'node:buffer'
import { exec, spawn } from 'node:child_process'
import { createPublicKey, X509Certificate } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { createSecureContext } from 'node:tls'

import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ensureDir, pathExists, readJson, remove } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import {
  RE_CERTIFICATE,
  RE_PRIVATE_KEY,
  RE_SAFE_RESTART_CMD,
} from '../../core/regex.constants.js'
import { SslCertGeneratorService } from '../../core/ssl/ssl-cert-generator.service.js'
import { AccessoriesService } from '../accessories/accessories.service.js'
import { ConfigEditorService } from '../config-editor/config-editor.service.js'
import { generateSetupCode, macToHex } from './server.utils.js'

/**
 * Homebridge restart/reset, main bridge setup code and the UI SSL settings.
 * Pairings, cached accessories, network settings and the wallpaper live in
 * their own `Server*Service` providers.
 */
@Injectable()
export class ServerService {
  private readonly accessoryId: string
  private readonly accessoryInfoPath: string

  public setupCode: string | null = null
  public paired: boolean = false

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(ConfigEditorService) private readonly configEditorService: ConfigEditorService,
    @Inject(AccessoriesService) private readonly accessoriesService: AccessoriesService,
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
    @Inject(Logger) private readonly logger: Logger,
  ) {
    this.accessoryId = macToHex(this.configService.homebridgeConfig.bridge.username)
    this.accessoryInfoPath = join(this.configService.storagePath, 'persist', `AccessoryInfo.${this.accessoryId}.json`)
  }

  /**
   * Restart the server
   */
  public async restartServer() {
    this.logger.debug('Homebridge restart request received.')

    if (!await this.configService.uiRestartRequired() && !await this.nodeVersionChanged()) {
      this.logger.log('UI/Bridge settings have not changed - only restarting Homebridge process.')
      // Restart homebridge by killing child process
      this.homebridgeIpcService.restartHomebridge()

      // Reset the pool of discovered homebridge instances
      this.accessoriesService.resetInstancePool()
      return { ok: true, command: 'SIGTERM', restartingUI: false }
    }

    setTimeout(() => {
      const restartCmd = this.configService.ui.restart
      if (!restartCmd) {
        this.logger.debug('Sending SIGTERM to process...')
        process.kill(process.pid, 'SIGTERM')
        return
      }
      this.logger.log(`Executing restart command ${restartCmd}.`)
      // Docker mode sets a multi-statement shell command in the loader
      // (`killall ... ; sleep ... ; killall ... ; kill -9 $(pidof ...)`),
      // which intentionally relies on shell semantics — that path stays
      // on `exec`. User-supplied commands flow through the allowlist
      // (RE_SAFE_RESTART_CMD), parsed to argv and run with
      // `spawn({ shell: false })` so an admin who edits config.json
      // can't inject arbitrary shell.
      if (this.configService.runningInDocker) {
        exec(restartCmd, (err) => {
          if (err) {
            this.logger.log('Restart command exited with an error, failed to restart Homebridge.')
          }
        })
        return
      }
      if (!RE_SAFE_RESTART_CMD.test(restartCmd)) {
        this.logger.error(`Refusing to run restart command — not on the allowlist: "${restartCmd}". Edit ui.restart to use a supported form (e.g. "sudo systemctl restart homebridge"). Falling back to SIGTERM.`)
        process.kill(process.pid, 'SIGTERM')
        return
      }
      const argv = restartCmd.split(/\s+/).filter(Boolean)
      const child = spawn(argv[0], argv.slice(1), { stdio: 'ignore', shell: false })
      child.on('error', () => {
        this.logger.log('Restart command exited with an error, failed to restart Homebridge.')
      })
    }, 500)

    return { ok: true, command: this.configService.ui.restart, restartingUI: true }
  }

  /**
   * Resets homebridge accessory and deletes all accessory cache.
   * Preserves plugin config.
   */
  public async resetHomebridgeAccessory() {
    // Restart ui on next restart
    this.configService.hbServiceUiRestartRequired = true

    const configFile = await this.configEditorService.getConfigFile()
    const oldUsername = configFile.bridge.username

    // Generate new random username and pin
    configFile.bridge.pin = this.configEditorService.generatePin()
    configFile.bridge.username = this.configEditorService.generateUsername()

    // Check if the original username is in the access list, if so, update it to the new username
    const uiConfig = configFile.platforms.find(x => x.platform === 'config')
    if (uiConfig.accessoryControl?.instanceBlacklist?.includes(oldUsername.toUpperCase())) {
      // Remove the old username from the blacklist, add the new one, and sort the blacklist alphabetically
      uiConfig.accessoryControl.instanceBlacklist = [...uiConfig.accessoryControl.instanceBlacklist
        .filter((x: string) => x.toUpperCase() !== oldUsername.toUpperCase()), configFile.bridge.username]
        .sort((a: string, b: string) => a.localeCompare(b))
    }

    this.logger.warn(`Homebridge bridge reset: new username ${configFile.bridge.username} and new pin ${configFile.bridge.pin}.`)

    // Save the config file
    await this.configEditorService.updateConfigFile(configFile)

    // Remove accessories, persist, and all matter directories
    await remove(resolve(this.configService.storagePath, 'accessories'))
    await remove(resolve(this.configService.storagePath, 'persist'))

    const matterDir = join(this.configService.storagePath, 'matter')
    if (await pathExists(matterDir)) {
      await remove(matterDir)
      this.logger.warn('Homebridge bridge reset: removed all Matter storage.')
    }

    this.logger.log('Homebridge bridge reset: accessories, persist, and matter directories were removed.')
  }

  /**
   * Returns existing setup code if cached, or requests one
   */
  public async getSetupCode(): Promise<string | null> {
    if (this.setupCode) {
      return this.setupCode
    } else {
      if (!await pathExists(this.accessoryInfoPath)) {
        return null
      }

      const accessoryInfo = await readJson(this.accessoryInfoPath)
      this.setupCode = generateSetupCode(accessoryInfo)
      return this.setupCode
    }
  }

  /**
   * Return the current pairing information for the main bridge
   */
  public async getBridgePairingInformation() {
    if (!await pathExists(this.accessoryInfoPath)) {
      throw new ServiceUnavailableException('Pairing Information Not Available Yet')
    }

    const accessoryInfo = await readJson(this.accessoryInfoPath)

    return {
      displayName: accessoryInfo.displayName,
      pincode: accessoryInfo.pincode,
      setupCode: await this.getSetupCode(),
      isPaired: accessoryInfo.pairedClients && Object.keys(accessoryInfo.pairedClients).length > 0,
    }
  }

  /**
   * Check if the system Node.js version has changed
   */
  private async nodeVersionChanged(): Promise<boolean> {
    return new Promise((res) => {
      let result = false

      const child = spawn(process.execPath, ['-v'])

      child.stdout.once('data', (data) => {
        result = data.toString().trim() !== process.version
      })

      child.on('error', () => {
        result = true
      })

      child.on('close', () => {
        return res(result)
      })
    })
  }

  /**
   * Upload a PEM key+cert pair, validate they match, save to storage, and update config
   */
  public async uploadSslKeyCert(req: FastifyRequest): Promise<{ ok: boolean, type: 'keycert', keyPath: string, certPath: string, details?: string }> {
    // Accept both specific field names (key, cert) and a generic 'files' array; detect content by PEM headers.
    // Override the global `files: 1` multipart limit since this endpoint legitimately receives a key + cert pair (#2789).
    const parts = req.parts ? req.parts({ limits: { files: 2 } }) : null
    const files: MultipartFile[] = []

    if (parts) {
      for await (const part of parts) {
        if ('file' in part && part.file) {
          files.push(part)
        }
      }
    } else {
      // Fallback to single file (should not happen for pair uploads)
      const single = await req.file()
      if (single?.file) {
        files.push(single)
      }
    }

    if (!files.length) {
      throw new BadRequestException('No files uploaded. Please upload both the private key and certificate files.')
    }

    // Read all file streams into buffers
    const readStreamToBuffer = async (stream: Readable): Promise<Buffer> => {
      const chunks: Buffer[] = []
      await new Promise<void>((resolvePromise, rejectPromise) => {
        stream.on('data', (d: Buffer) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
        stream.on('end', () => resolvePromise())
        stream.on('error', rejectPromise)
      })
      return Buffer.concat(chunks)
    }

    let keyPem: Buffer | null = null
    let certPem: Buffer | null = null

    for (const f of files) {
      if (f.file?.truncated) {
        throw new InternalServerErrorException(`Upload exceeds maximum size ${globalThis.backup.maxBackupSizeText}.`)
      }
      const buf = await readStreamToBuffer(f.file as unknown as Readable)
      const text = buf.toString('utf8')

      // A single PEM may contain both a key and a cert (combined bundle); test each independently
      // rather than as if/else, so one upload can populate both slots if needed
      const hasKey = RE_PRIVATE_KEY.test(text)
      const hasCert = RE_CERTIFICATE.test(text)
      if (hasKey && !keyPem) {
        keyPem = buf
      }
      if (hasCert && !certPem) {
        certPem = buf
      }

      // Fall back to fieldname only when neither PEM marker is present (e.g. DER uploads).
      if (!hasKey && !hasCert) {
        if (f.fieldname === 'key' && !keyPem) {
          keyPem = buf
        } else if (f.fieldname === 'cert' && !certPem) {
          certPem = buf
        }
      }
    }

    if (!keyPem || !certPem) {
      throw new BadRequestException('Both a PEM private key and certificate must be provided.')
    }

    // Validate: ensure key matches cert public key
    try {
      const x509 = new X509Certificate(certPem)
      const certPub = x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
      const pubFromPriv = createPublicKey(keyPem).export({ type: 'spki', format: 'der' }) as Buffer
      if (!certPub.equals(pubFromPriv)) {
        throw new BadRequestException('The private key does not match the certificate public key.')
      }

      // Also try building a TLS context to verify basic integrity
      createSecureContext({ key: keyPem, cert: certPem })
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e
      }
      throw new BadRequestException(`Invalid key/certificate: ${e?.message || e}`)
    }

    // Save files to storagePath/ssl-certs
    const sslDir = join(this.configService.storagePath, 'ssl-certs')
    const keyPath = join(sslDir, 'ui-ssl.key')
    const certPath = join(sslDir, 'ui-ssl.crt')

    await ensureDir(sslDir)

    // If existing files exist at these paths, overwrite them
    await writeFile(keyPath, keyPem)
    await writeFile(certPath, certPem)

    // Update config.json UI block
    const configFile = await this.configEditorService.getConfigFile()
    const uiConfigBlock = configFile.platforms.find(x => x.platform === 'config')
    if (!uiConfigBlock) {
      throw new InternalServerErrorException('Config platform block not found.')
    }
    if (!uiConfigBlock.ssl) {
      uiConfigBlock.ssl = {}
    }
    uiConfigBlock.ssl.key = keyPath
    uiConfigBlock.ssl.cert = certPath

    // Clear pfx settings and selfSigned
    delete uiConfigBlock.ssl.pfx
    delete uiConfigBlock.ssl.passphrase
    uiConfigBlock.ssl.selfSigned = false

    await this.configEditorService.updateConfigFile(configFile)

    return {
      ok: true,
      type: 'keycert',
      keyPath,
      certPath,
      details: 'Certificate and key validated and saved.',
    }
  }

  /**
   * Upload a PFX, validate passphrase, save to storage, and update config
   */
  public async uploadSslPfx(req: FastifyRequest): Promise<{ ok: boolean, type: 'pfx', pfxPath: string, details?: string }> {
    // Expect file field named 'pfx' (or any file) and optional field 'passphrase'
    let passphrase: string | undefined
    let filePart: MultipartFile | undefined

    if (req.parts) {
      for await (const part of req.parts()) {
        const file = part as MultipartFile
        const field = part as MultipartValue<string>
        if (part.type === 'file' || file.file) {
          filePart = file
        } else if (part.type === 'field' || field.value) {
          if (part.fieldname === 'passphrase') {
            passphrase = field.value
          }
        }
      }
    } else {
      // Fallback to single-file API
      filePart = await req.file()
      passphrase = (req.body as { passphrase?: string } | undefined)?.passphrase
    }

    if (!filePart) {
      throw new BadRequestException('No PFX file uploaded.')
    }
    if (filePart.file?.truncated) {
      throw new InternalServerErrorException(`Upload exceeds maximum size ${globalThis.backup.maxBackupSizeText}.`)
    }

    const readStreamToBuffer = async (stream: Readable): Promise<Buffer> => {
      const chunks: Buffer[] = []
      await new Promise<void>((resolvePromise, rejectPromise) => {
        stream.on('data', (d: Buffer) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
        stream.on('end', () => resolvePromise())
        stream.on('error', rejectPromise)
      })
      return Buffer.concat(chunks)
    }
    const pfxBuffer = await readStreamToBuffer(filePart.file as unknown as Readable)

    // Validate by attempting to create a secure context
    try {
      createSecureContext({ pfx: pfxBuffer, passphrase })
    } catch (e) {
      // OpenSSL errors will be thrown here if the passphrase is wrong or the file is invalid
      throw new BadRequestException(`Invalid PFX or passphrase: ${e?.message || e}`)
    }

    // Save to storage
    const sslDir = join(this.configService.storagePath, 'ssl-certs')
    const pfxPath = join(sslDir, 'ui-ssl.pfx')
    await ensureDir(sslDir)
    await writeFile(pfxPath, pfxBuffer)

    // Update config
    const configFile = await this.configEditorService.getConfigFile()
    const uiConfigBlock = configFile.platforms.find(x => x.platform === 'config')
    if (!uiConfigBlock) {
      throw new InternalServerErrorException('Config platform block not found.')
    }
    if (!uiConfigBlock.ssl) {
      uiConfigBlock.ssl = {}
    }
    uiConfigBlock.ssl.pfx = pfxPath
    uiConfigBlock.ssl.passphrase = passphrase || ''

    // Clear other ssl modes
    delete uiConfigBlock.ssl.key
    delete uiConfigBlock.ssl.cert
    uiConfigBlock.ssl.selfSigned = false

    await this.configEditorService.updateConfigFile(configFile)

    return {
      ok: true,
      type: 'pfx',
      pfxPath,
      details: 'PFX validated and saved.',
    }
  }

  /**
   * Validate the currently configured SSL settings
   */
  public async validateCurrentSslConfig(): Promise<{ ok: boolean, valid: boolean, type: 'off' | 'selfsigned' | 'keycert' | 'pfx', details?: string }> {
    const configFile = await this.configEditorService.getConfigFile()
    const uiConfigBlock = configFile.platforms.find(x => x.platform === 'config')
    const ssl = uiConfigBlock?.ssl || {}

    if (!ssl || (!ssl.selfSigned && !ssl.key && !ssl.cert && !ssl.pfx)) {
      return { ok: true, valid: true, type: 'off', details: 'HTTPS is disabled.' }
    }

    if (ssl.selfSigned) {
      return { ok: true, valid: true, type: 'selfsigned', details: 'Self-signed mode enabled.' }
    }

    try {
      if (ssl.key && ssl.cert) {
        const keyPem = await readFile(ssl.key)
        const certPem = await readFile(ssl.cert)
        const x509 = new X509Certificate(certPem)
        const certPub = x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
        const pubFromPriv = createPublicKey(keyPem).export({ type: 'spki', format: 'der' }) as Buffer
        if (!certPub.equals(pubFromPriv)) {
          return { ok: true, valid: false, type: 'keycert', details: 'Private key does not match certificate.' }
        }
        createSecureContext({ key: keyPem, cert: certPem })
        return { ok: true, valid: true, type: 'keycert', details: 'Key and certificate are valid and match.' }
      }

      if (ssl.pfx) {
        const pfx = await readFile(ssl.pfx)
        createSecureContext({ pfx, passphrase: ssl.passphrase })
        return { ok: true, valid: true, type: 'pfx', details: 'PFX file and passphrase are valid.' }
      }
    } catch (e) {
      return { ok: true, valid: false, type: ssl.pfx ? 'pfx' : 'keycert', details: e?.message || String(e) }
    }

    return { ok: true, valid: false, type: 'off', details: 'No SSL configuration found.' }
  }

  /**
   * Generate a self-signed certificate now and optionally set it as the active key/cert in config.
   * @param options - object containing self-signed generation options
   * @param options.hostnames - optional list of hostnames / IPs for Subject Alternative Name
   * @param options.mode - 'keycert' to use generated files as ssl.key/cert, or 'selfsigned' to enable self-signed mode
   */
  public async generateSelfSignedCertificate(
    options: { hostnames?: string[], mode?: 'keycert' | 'selfsigned' } = {},
  ): Promise<{
    ok: boolean
    type: 'generated'
    mode: 'keycert' | 'selfsigned'
    keyPath?: string
    certPath?: string
    details?: string
  }> {
    const hostnames = Array.isArray(options.hostnames) && options.hostnames.length
      ? options.hostnames.map(h => String(h).trim()).filter(Boolean)
      : ['localhost', '127.0.0.1']
    const mode = options.mode || 'keycert'

    // Generate and persist the certificate to storagePath/ssl-certs
    const generator = new SslCertGeneratorService()
    await generator.generateCertificate(hostnames)

    const sslDir = join(this.configService.storagePath, 'ssl-certs')
    const keyPath = join(sslDir, 'private-key.pem')
    const certPath = join(sslDir, 'certificate.pem')

    // Update config.json UI block according to mode
    const configFile = await this.configEditorService.getConfigFile()
    const uiConfigBlock = configFile.platforms.find(x => x.platform === 'config')
    if (!uiConfigBlock.ssl) {
      uiConfigBlock.ssl = {}
    }

    if (mode === 'keycert') {
      uiConfigBlock.ssl.key = keyPath
      uiConfigBlock.ssl.cert = certPath
      delete uiConfigBlock.ssl.pfx
      delete uiConfigBlock.ssl.passphrase
      delete uiConfigBlock.ssl.selfSigned
      delete uiConfigBlock.ssl.selfSignedHostnames
    } else {
      // Keep using runtime self-signed mode on startup
      delete uiConfigBlock.ssl.key
      delete uiConfigBlock.ssl.cert
      delete uiConfigBlock.ssl.pfx
      delete uiConfigBlock.ssl.passphrase
      uiConfigBlock.ssl.selfSigned = true
      uiConfigBlock.ssl.selfSignedHostnames = hostnames
    }

    await this.configEditorService.updateConfigFile(configFile)

    return {
      ok: true,
      type: 'generated',
      mode,
      keyPath: mode === 'keycert' ? keyPath : undefined,
      certPath: mode === 'keycert' ? certPath : undefined,
      details: `Self-signed certificate generated for ${hostnames.join(', ')}`,
    }
  }
}
