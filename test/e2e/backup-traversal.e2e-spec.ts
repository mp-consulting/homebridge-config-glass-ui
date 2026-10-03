import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { Buffer } from 'node:buffer'
import { lstat, mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'

import fastifyMultipart from '@fastify/multipart'
import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import FormData from 'form-data'
import { copy, pathExists, readFile, remove } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { SchedulerService } from '../../src/core/scheduler/scheduler.service.js'
import { BackupModule } from '../../src/modules/backup/backup.module.js'
import { BackupService } from '../../src/modules/backup/backup.service.js'
import { UsersModule } from '../../src/modules/users/users.module.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

/**
 * Crafted restore archives must never write outside the temporary restore
 * directory, and scheduled-backup ids must not reach outside the
 * instance-backups directory.
 */

interface RawEntry {
  path: string
  /** ustar type flag: '0' file, '1' hardlink, '2' symlink, '5' dir, '6' FIFO */
  type?: '0' | '1' | '2' | '5' | '6'
  data?: string
  linkpath?: string
}

/**
 * Build a gzipped tar by hand. The `tar` package refuses to create entries
 * with `..` or absolute paths, which is exactly what these tests need.
 */
function rawTarGz(entries: RawEntry[]): Buffer {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const type = entry.type ?? '0'
    const data = Buffer.from(type === '0' ? entry.data ?? '' : '')
    const header = Buffer.alloc(512)
    header.write(entry.path, 0, 100, 'utf8')
    header.write('0000644\0', 100, 8, 'ascii')
    header.write('0000000\0', 108, 8, 'ascii')
    header.write('0000000\0', 116, 8, 'ascii')
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 12, 'ascii')
    header.write('        ', 148, 8, 'ascii') // checksum placeholder
    header.write(type, 156, 1, 'ascii')
    if (entry.linkpath) {
      header.write(entry.linkpath, 157, 100, 'utf8')
    }
    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')
    let sum = 0
    for (const byte of header) {
      sum += byte
    }
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
    blocks.push(header)
    if (data.length) {
      blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512))
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

/** Every file and directory under `dir`, relative to it */
async function walk(dir: string, prefix = ''): Promise<string[]> {
  if (!await pathExists(dir)) {
    return []
  }
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    out.push(rel)
    if (entry.isDirectory()) {
      out.push(...await walk(join(dir, entry.name), rel))
    }
  }
  return out
}

describe('Backup path traversal (e2e)', { timeout: 30_000 }, () => {
  let app: NestFastifyApplication
  let backupService: BackupService
  let configService: ConfigService
  let schedulerService: SchedulerService
  let adminAuthorization: string
  let userAuthorization: string

  const storage = testStoragePath
  const mocks = resolve(__dirname, '../mocks')
  // os.tmpdir() honours TMPDIR, so the restore's mkdtemp lands in a sandbox
  // this spec can inspect in full. Spec files run in their own worker.
  const sandboxTmp = resolve(storage, 'tmp')
  const instanceBackupPath = resolve(storage, 'backups/instance-backups')
  const originalTmpdir = process.env.TMPDIR

  const upload = async (archive: Buffer, authorization = adminAuthorization) => {
    const form = new FormData()
    form.append('backup.tar.gz', archive, { filename: 'backup.tar.gz' })
    const headers = form.getHeaders()
    headers.authorization = authorization
    return app.inject({ method: 'POST', path: '/backup/restore', headers, payload: form })
  }

  const restoreDirectory = () => (backupService as any).restoreDirectory as string | undefined

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = storage
    process.env.UIX_CONFIG_PATH = resolve(storage, 'config.json')
    process.env.TMPDIR = sandboxTmp

    await copy(resolve(mocks, 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(mocks, 'auth.json'), resolve(storage, 'auth.json'))
    await copy(resolve(mocks, '.uix-secrets'), resolve(storage, '.uix-secrets'))

    const moduleFixture = await Test.createTestingModule({
      imports: [BackupModule, AuthModule, UsersModule],
    }).compile()

    const adapter = new FastifyAdapter()
    adapter.register(fastifyMultipart, {
      limits: { files: 1, fileSize: globalThis.backup.maxBackupSize },
    })
    app = moduleFixture.createNestApplication<NestFastifyApplication>(adapter)
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    backupService = app.get(BackupService)
    configService = app.get(ConfigService)
    schedulerService = app.get(SchedulerService)
    configService.instanceBackupPath = instanceBackupPath

    adminAuthorization = `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })).json().access_token}`

    const created = await app.inject({
      method: 'POST',
      path: '/users',
      headers: { authorization: adminAuthorization },
      payload: { name: 'Regular', username: 'regular', password: 'regular-password', admin: false },
    })
    if (created.statusCode !== 201) {
      throw new Error(`could not create the non-admin user: ${created.statusCode}`)
    }
    userAuthorization = `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'regular', password: 'regular-password' },
    })).json().access_token}`
  })

  beforeEach(async () => {
    await backupService.removeRestoreDirectory()
    await remove(sandboxTmp)
    await mkdir(sandboxTmp, { recursive: true })
  })

  afterEach(async () => {
    await backupService.removeRestoreDirectory()
  })

  afterAll(async () => {
    process.env.TMPDIR = originalTmpdir
    schedulerService.scheduledJobs['instance-backup']?.cancel()
    await app.close()
  })

  describe('pOST /backup/restore with crafted entries', () => {
    const safeEntries: RawEntry[] = [
      { path: 'info.json', data: '{}' },
      { path: 'plugins.json', data: '[]' },
      { path: 'storage/config.json', data: '{}' },
    ]

    /**
     * Upload the safe entries plus the crafted ones. The extractor skips the
     * crafted entries (tarSafeFilter) and the upload still succeeds, so only
     * the safe files exist, all inside the restore directory.
     */
    const expectSkipped = async (crafted: RawEntry[]) => {
      const res = await upload(rawTarGz([...safeEntries, ...crafted]))
      expect(res.statusCode).toBe(201)

      const dir = restoreDirectory()
      expect(dir).toBeDefined()
      expect(resolve(dir!, '..')).toBe(sandboxTmp)

      // Nothing outside the restore directory
      const name = dir!.slice(sandboxTmp.length + 1)
      expect((await walk(sandboxTmp)).filter(p => p !== name && !p.startsWith(`${name}/`))).toEqual([])
      // And only the safe files inside it
      expect((await walk(dir!)).sort()).toEqual(['info.json', 'plugins.json', 'storage', 'storage/config.json'])
    }

    it('skips a `../` entry', async () => {
      await expectSkipped([{ path: '../evil.txt', data: 'pwned' }])
      expect(await pathExists(resolve(sandboxTmp, 'evil.txt'))).toBe(false)
    })

    it('skips a nested `foo/../../` entry', async () => {
      await expectSkipped([
        { path: 'foo/../../evil.txt', data: 'pwned' },
        { path: 'storage/../../../evil.txt', data: 'pwned' },
      ])
      expect(await pathExists(resolve(sandboxTmp, 'evil.txt'))).toBe(false)
      expect(await pathExists(resolve(storage, 'evil.txt'))).toBe(false)
    })

    it('skips absolute entries', async () => {
      const absoluteTarget = resolve(storage, 'absolute-evil.txt')
      await expectSkipped([
        { path: '/etc/evil', data: 'pwned' },
        { path: absoluteTarget, data: 'pwned' },
      ])
      expect(await pathExists(absoluteTarget)).toBe(false)
    })

    it('skips a hardlink to a file outside the archive', async () => {
      const authBefore = await readFile(resolve(storage, 'auth.json'), 'utf8')
      await expectSkipped([
        { path: 'storage/auth.json', type: '1', linkpath: resolve(storage, 'auth.json') },
        { path: 'storage/relative-hardlink', type: '1', linkpath: '../../auth.json' },
      ])
      expect(await readFile(resolve(storage, 'auth.json'), 'utf8')).toBe(authBefore)
    })

    it('skips a symlink, and a file written through it', async () => {
      const outside = resolve(storage, 'outside')
      await mkdir(outside, { recursive: true })
      const res = await upload(rawTarGz([
        ...safeEntries,
        { path: 'storage/link', type: '2', linkpath: outside },
        { path: 'storage/link/evil.txt', data: 'pwned' },
      ]))
      expect(res.statusCode).toBe(201)

      // The link itself is skipped, so the later entry lands in a real
      // directory inside the restore dir instead of following the link
      const dir = restoreDirectory()!
      expect((await lstat(resolve(dir, 'storage/link'))).isSymbolicLink()).toBe(false)
      expect(await readFile(resolve(dir, 'storage/link/evil.txt'), 'utf8')).toBe('pwned')
      expect(await walk(outside)).toEqual([])
    })

    it('skips a FIFO', async () => {
      await expectSkipped([{ path: 'storage/fifo', type: '6' }])
      expect(await pathExists(resolve(restoreDirectory()!, 'storage/fifo'))).toBe(false)
    })
  })

  describe('scheduled backup ids', () => {
    const encoded = '..%2F..%2Fauth.json'

    beforeEach(async () => {
      await mkdir(instanceBackupPath, { recursive: true })
    })

    it('gET /backup/scheduled-backups/..%2F..%2Fauth.json is refused without streaming a file', async () => {
      const authContents = await readFile(resolve(storage, 'auth.json'), 'utf8')
      const res = await app.inject({
        method: 'GET',
        url: `/backup/scheduled-backups/${encoded}`,
        headers: { authorization: adminAuthorization },
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).not.toContain('hashedPassword')
      expect(res.body).not.toContain(authContents.slice(0, 40))
    })

    it('dELETE /backup/scheduled-backups/..%2F..%2Fauth.json is refused without deleting anything', async () => {
      // A file that the traversal would resolve to, were it not refused
      const decoy = resolve(instanceBackupPath, '../../auth.json')
      const res = await app.inject({
        method: 'DELETE',
        url: `/backup/scheduled-backups/${encoded}`,
        headers: { authorization: adminAuthorization },
      })
      expect(res.statusCode).toBe(400)
      expect(await pathExists(decoy)).toBe(true)
      expect(await pathExists(resolve(storage, 'auth.json'))).toBe(true)
    })

    it('a valid-looking id that does not exist is a 404, not a traversal', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/backup/scheduled-backups/0ACAC1AC01AC.1765432100000',
        headers: { authorization: adminAuthorization },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('non-admin users', () => {
    it('pOST /backup/restore answers 403 and writes nothing', async () => {
      const res = await upload(rawTarGz([{ path: 'info.json', data: '{}' }]), userAuthorization)
      expect(res.statusCode).toBe(403)
      expect(restoreDirectory()).toBeUndefined()
      expect(await walk(sandboxTmp)).toEqual([])
    })
  })
})
