import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { Buffer } from 'node:buffer'
import { stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, ensureDir, readdir, remove } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuditService } from '../../src/core/audit/audit.service.js'
import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { AppEventsService } from '../../src/core/events/app-events.service.js'
import { BackupScheduler } from '../../src/modules/backup/backup-scheduler.js'
import { BackupModule } from '../../src/modules/backup/backup.module.js'
import { BackupDestinationsService } from '../../src/modules/backup/offsite/backup-destinations.service.js'
import { signV4 } from '../../src/modules/backup/offsite/s3-client.js'
import { parsePropfind } from '../../src/modules/backup/offsite/webdav-client.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

const ID = '0e0000000001'
const file = (ts: number) => `homebridge-backup-${ID}.${ts}.tar.gz`

describe('Off-site backups', () => {
  describe('the protocols', () => {
    it('signs S3 requests as AWS documents (Signature Version 4 examples)', () => {
      const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' }
      const headers = { 'host': 'examplebucket.s3.amazonaws.com', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' }

      expect(signV4({ method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), headers: { ...headers, range: 'bytes=0-9' } }, credentials))
        .toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
      expect(signV4({ method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'), headers }, credentials))
        .toContain('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7')
    })

    it('reads the files of a WebDAV folder, not the folder or its subfolders', () => {
      const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/dav/hb/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
        <d:response><d:href>/dav/hb/${file(1)}</d:href><d:propstat><d:prop><d:getcontentlength>42</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>
        <d:response><d:href>https://cloud.example.com/dav/hb/sub/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
        <d:response><d:href>/dav/hb/notes%20today.txt</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
      </d:multistatus>`

      expect(parsePropfind(xml, new URL('https://cloud.example.com/dav/hb/'))).toEqual([{ name: file(1), size: 42 }, { name: 'notes today.txt', size: 0 }])
    })
  })

  describe('settings and uploads (e2e)', () => {
    let app: NestFastifyApplication
    let authorization: string
    let destinations: BackupDestinationsService
    let scheduler: BackupScheduler
    let configService: ConfigService
    let fetchMock: ReturnType<typeof vi.fn>
    /** What the fake WebDAV folder holds. */
    let remoteFiles: string[]

    beforeAll(async () => {
      process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
      process.env.UIX_STORAGE_PATH = testStoragePath
      process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
      await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
      await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
      await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

      const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [BackupModule, AuthModule] }).compile()
      app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
      await app.init()
      await app.getHttpAdapter().getInstance().ready()

      destinations = app.get(BackupDestinationsService)
      scheduler = app.get(BackupScheduler)
      configService = app.get(ConfigService)
      configService.instanceBackupPath = resolve(testStoragePath, 'backups/offsite-test')
    })

    beforeEach(async () => {
      remoteFiles = []
      fetchMock = vi.fn(async (url: URL | string, init: NonNullable<Parameters<typeof fetch>[1]> = {}) => {
        const href = String(url)
        if (init.method === 'PROPFIND') {
          const body = remoteFiles.map(name => `<d:response><d:href>/dav/hb/${name}</d:href><d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength></d:prop></d:propstat></d:response>`).join('')
          return new Response(`<d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`, { status: 207 })
        }
        if (init.method === 'PUT') {
          remoteFiles.push(decodeURIComponent(href.split('/').pop()!))
          return new Response('', { status: 201 })
        }
        if (init.method === 'DELETE') {
          remoteFiles = remoteFiles.filter(name => name !== decodeURIComponent(href.split('/').pop()!))
          return new Response(null, { status: 204 })
        }
        return new Response('<ListBucketResult></ListBucketResult>', { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)
      await remove(destinations.filePath)
      ;(destinations as any).cached = null
      await remove(configService.instanceBackupPath)
      await ensureDir(configService.instanceBackupPath)
      authorization ??= `bearer ${(await app.inject({ method: 'POST', path: '/auth/login', payload: { username: 'admin', password: 'admin' } })).json().access_token}`
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    afterAll(async () => {
      await app.close()
    })

    const put = (payload: unknown) => app.inject({ method: 'PUT', path: '/backup/destinations', headers: { authorization }, payload: payload as any })
    const webdav = { enabled: true, url: 'https://cloud.example.com/dav/hb', username: 'me', password: 'pa55word', keep: 2 }

    /** A scheduled backup run with a stand-in archive. */
    async function runJob() {
      const backupDir = resolve(testStoragePath, `tmp-backup-${Date.now()}`)
      await ensureDir(backupDir)
      const backupPath = resolve(backupDir, 'backup.tar.gz')
      await writeFile(backupPath, 'tar')
      await scheduler.runJob(async () => ({ backupDir, backupPath, instanceId: ID }))
    }

    it('starts with nothing enabled and 7 days kept locally', async () => {
      const res = await app.inject({ method: 'GET', path: '/backup/destinations', headers: { authorization } })

      expect(res.json()).toMatchObject({ keepLocal: null, webdav: { enabled: false, keep: 7 }, s3: { enabled: false, forcePathStyle: true, keep: 7 }, lastRun: null })
    })

    it('stores secrets owner-only and never returns them', async () => {
      const res = await put({ webdav, s3: { endpoint: 'https://s3.example.com', bucket: 'hb-backups', accessKeyId: 'AKID', secretAccessKey: 's3cret' } })

      expect(res.statusCode).toBe(200)
      expect(res.json().webdav.password).toBe('********')
      expect(res.json().s3.secretAccessKey).toBe('********')
      expect(JSON.stringify(res.json())).not.toContain('pa55word')
      await vi.waitFor(async () => {
        const { entries } = await app.get(AuditService).list({ action: 'backup.destinations.update' })
        expect(entries[0]).toMatchObject({ ok: true, details: { webdav: { enabled: true, url: webdav.url, keep: 2 } } })
        expect(JSON.stringify(entries)).not.toContain('pa55word')
        expect(JSON.stringify(entries)).not.toContain('s3cret')
      })
      const mode = (await stat(destinations.filePath)).mode & 0o777
      expect(process.platform === 'win32' || mode === 0o600).toBe(true)

      // The placeholder keeps the stored value
      await put({ webdav: { ...webdav, password: '********', keep: 3 } })
      ;(destinations as any).cached = null
      expect((await (destinations as any).load()).webdav).toMatchObject({ password: 'pa55word', keep: 3 })
    })

    it('refuses invalid settings', async () => {
      expect((await put({ keepLocal: 0 })).statusCode).toBe(400)
      expect((await put({ webdav: { enabled: true } })).statusCode).toBe(400)
      expect((await put({ webdav: { url: 'ftp://x' } })).statusCode).toBe(400)
      expect((await put({ s3: { enabled: true, endpoint: 'https://s3.example.com' } })).statusCode).toBe(400)
      expect((await put({ s3: { prefix: '../etc' } })).statusCode).toBe(400)
      expect((await put({ webdav: { keep: 'x' } })).statusCode).toBe(400)
    })

    it('needs an administrator', async () => {
      expect((await app.inject({ method: 'GET', path: '/backup/destinations' })).statusCode).toBe(401)
    })

    it('tests a WebDAV folder with the unsaved settings and Basic auth', async () => {
      const res = await app.inject({ method: 'POST', path: '/backup/destinations/test', headers: { authorization }, payload: { destination: 'webdav', settings: webdav } })

      expect(res.json()).toEqual({ destination: 'webdav', ok: true })
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe('https://cloud.example.com/dav/hb/')
      expect(init.method).toBe('PROPFIND')
      expect(init.headers.authorization).toBe(`Basic ${Buffer.from('me:pa55word').toString('base64')}`)
    })

    it('tests an S3 bucket with a signed request, and reports a refusal without the secret', async () => {
      fetchMock.mockResolvedValueOnce(new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 }))
      const res = await app.inject({
        method: 'POST',
        path: '/backup/destinations/test',
        headers: { authorization },
        payload: { destination: 's3', settings: { endpoint: 'https://s3.example.com', region: 'eu-west-1', bucket: 'hb-backups', prefix: 'hb/', accessKeyId: 'AKID', secretAccessKey: 's3cret' } },
      })

      expect(res.json()).toEqual({ destination: 's3', ok: false, error: 'S3 GET answered HTTP 403 (SignatureDoesNotMatch)' })
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe('https://s3.example.com/hb-backups?list-type=2&prefix=hb%2F&max-keys=1')
      expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/eu-west-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    })

    it('refuses to test a destination that is not set up', async () => {
      expect((await app.inject({ method: 'POST', path: '/backup/destinations/test', headers: { authorization }, payload: { destination: 'webdav' } })).statusCode).toBe(400)
      expect((await app.inject({ method: 'POST', path: '/backup/destinations/test', headers: { authorization }, payload: { destination: 'ftp' } })).statusCode).toBe(400)
    })

    it('uploads a scheduled backup and keeps the newest copies remotely', async () => {
      await put({ webdav })
      remoteFiles = [file(1000000000), file(1000000001), file(1000000002), 'someone-elses-file.txt', `homebridge-backup-0e0000000002.1000000000.tar.gz`]
      const succeeded = vi.fn()
      app.get(AppEventsService).on('backupSucceeded', succeeded)

      await runJob()

      const ours = remoteFiles.filter(name => name.startsWith(`homebridge-backup-${ID}.`))
      expect(ours).toHaveLength(2)
      expect(ours).not.toContain(file(1000000000))
      expect(ours).not.toContain(file(1000000001))
      // Other files and other instances' backups are left alone
      expect(remoteFiles).toContain('someone-elses-file.txt')
      expect(remoteFiles).toContain('homebridge-backup-0e0000000002.1000000000.tar.gz')
      expect(succeeded).toHaveBeenCalledWith(expect.objectContaining({ uploads: [{ destination: 'webdav', ok: true, removed: 2 }] }))
      expect((await destinations.getSettings()).lastRun).toMatchObject({ results: [{ destination: 'webdav', ok: true }] })
      app.get(AppEventsService).off('backupSucceeded', succeeded)
    })

    it('reports a failed upload as a failed backup, without the password', async () => {
      await put({ webdav })
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED pa55word'))
      const failed = vi.fn()
      app.get(AppEventsService).on('backupFailed', failed)

      await runJob()

      expect(failed).toHaveBeenCalledWith({ message: expect.stringContaining('upload failed: webdav: connect ECONNREFUSED ********') })
      // The local copy is still saved
      expect(await readdir(configService.instanceBackupPath)).toHaveLength(1)
      app.get(AppEventsService).off('backupFailed', failed)
    })

    it('keeps the newest keepLocal backups locally when set', async () => {
      await put({ keepLocal: 2 })
      const now = Date.now()
      for (const ts of [now - 3000, now - 2000, now - 1000]) {
        await writeFile(resolve(configService.instanceBackupPath, file(ts)), 'x')
      }

      await runJob()

      expect(await readdir(configService.instanceBackupPath)).toHaveLength(2)
    })

    it('reports a backup that could not be created', async () => {
      const failed = vi.fn()
      app.get(AppEventsService).on('backupFailed', failed)

      await scheduler.runJob(async () => {
        throw new Error('disk full')
      })

      expect(failed).toHaveBeenCalledWith({ message: 'disk full' })
      app.get(AppEventsService).off('backupFailed', failed)
    })
  })
})
