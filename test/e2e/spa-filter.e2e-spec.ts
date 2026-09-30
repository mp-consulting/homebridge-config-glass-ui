import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { Module } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SpaFilter } from '../../src/core/spa/spa.filter.js'
import { testStoragePath } from '../storage-path.js'

@Module({})
class EmptyModule {}

describe('SpaFilter (e2e)', () => {
  let app: NestFastifyApplication
  let filter: SpaFilter
  const indexPath = resolve(testStoragePath, 'public', 'index.html')

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = testStoragePath

    const moduleFixture = await Test.createTestingModule({
      imports: [EmptyModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    filter = new SpaFilter()
    app.useGlobalFilters(filter)

    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterEach(async () => {
    // every test starts from a cold filter and no index.html
    ;(filter as any).indexHtml = null
    await rm(resolve(testStoragePath, 'public'), { recursive: true, force: true })
  })

  it('serves index.html, uncached by the browser, for a non-API route', async () => {
    await mkdir(resolve(testStoragePath, 'public'), { recursive: true })
    await writeFile(indexPath, '<html>spa</html>')

    const res = await app.inject({ method: 'GET', path: '/some/client/route' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate')
    expect(res.body).toBe('<html>spa</html>')
  })

  it('answers a plain 404 for API, socket.io and asset paths', async () => {
    for (const path of ['/api/nothing', '/socket.io/x', '/assets/missing.js']) {
      const res = await app.inject({ method: 'GET', path })
      expect(res.statusCode).toBe(404)
      expect(res.body).toBe('Not Found')
    }
  })

  it('serves index.html from memory while the file is unchanged', async () => {
    await mkdir(resolve(testStoragePath, 'public'), { recursive: true })
    // A whole-second timestamp, so it round-trips through utimes exactly
    const mtime = new Date('2026-01-01T00:00:00Z')
    await writeFile(indexPath, '<html>first</html>')
    await utimes(indexPath, mtime, mtime)
    expect((await app.inject({ method: 'GET', path: '/a' })).body).toBe('<html>first</html>')

    // Same size and mtime: indistinguishable from unchanged, so the cached copy is served
    await writeFile(indexPath, '<html>other</html>')
    await utimes(indexPath, mtime, mtime)
    expect((await app.inject({ method: 'GET', path: '/b' })).body).toBe('<html>first</html>')
  })

  it('picks up a rebuilt index.html without a restart', async () => {
    await mkdir(resolve(testStoragePath, 'public'), { recursive: true })
    await writeFile(indexPath, '<html><script src="main-OLD.js"></script></html>')
    expect((await app.inject({ method: 'GET', path: '/a' })).body).toContain('main-OLD.js')

    await writeFile(indexPath, '<html><script src="main-NEWHASH.js"></script></html>')
    expect((await app.inject({ method: 'GET', path: '/b' })).body).toContain('main-NEWHASH.js')
  })

  it('fails the request while index.html is missing, and retries once it appears', async () => {
    const missing = await app.inject({ method: 'GET', path: '/a' })
    expect(missing.statusCode).toBe(500)
    expect(missing.json()).toEqual({ statusCode: 500, message: 'Internal server error' })

    await mkdir(resolve(testStoragePath, 'public'), { recursive: true })
    await writeFile(indexPath, '<html>built</html>')

    const res = await app.inject({ method: 'GET', path: '/a' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('<html>built</html>')
  })

  afterAll(async () => {
    await app.close()
  })
})
