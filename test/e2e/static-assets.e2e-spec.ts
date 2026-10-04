import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib'

import fastifyStatic from '@fastify/static'
import { Module } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { ensureDir, writeFile } from 'fs-extra'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { staticAssetOptions } from '../../src/core/static-assets.js'
import { testStoragePath } from '../storage-path.js'

@Module({})
class EmptyModule {}

describe('Static assets (e2e)', () => {
  let app: NestFastifyApplication
  const publicPath = resolve(testStoragePath, 'public')
  const hashedJs = `console.log(${JSON.stringify('x'.repeat(4096))})\n`

  beforeAll(async () => {
    await ensureDir(resolve(publicPath, 'assets'))
    await writeFile(resolve(publicPath, 'assets/index-B2nQZ0s0.js'), hashedJs)
    await writeFile(resolve(publicPath, 'assets/index-B2nQZ0s0.js.br'), brotliCompressSync(hashedJs))
    await writeFile(resolve(publicPath, 'assets/index-B2nQZ0s0.js.gz'), gzipSync(hashedJs))
    await writeFile(resolve(publicPath, 'manifest.json'), '{"name":"x"}'.padEnd(2048, ' '))
    await writeFile(resolve(publicPath, 'sw.js'), 'self.addEventListener("fetch", () => {})\n')
    await writeFile(resolve(publicPath, 'manifest.json.br'), brotliCompressSync('{"name":"x"}'.padEnd(2048, ' ')))

    const moduleFixture = await Test.createTestingModule({ imports: [EmptyModule] }).compile()
    const adapter = new FastifyAdapter()
    // Same options main.ts passes to app.useStaticAssets()
    adapter.register(fastifyStatic, { root: publicPath, ...staticAssetOptions })
    app = moduleFixture.createNestApplication<NestFastifyApplication>(adapter)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('serves the brotli variant of a hashed asset with immutable cache headers', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/assets/index-B2nQZ0s0.js',
      headers: { 'accept-encoding': 'br, gzip' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBe('br')
    expect(res.headers['content-type']).toMatch(/javascript/)
    expect(res.headers.vary).toMatch(/accept-encoding/i)
    expect(res.headers['cache-control']).toBe('public,max-age=31536000,immutable')
    expect(brotliDecompressSync(res.rawPayload).toString()).toBe(hashedJs)
  })

  it('serves the gzip variant when brotli is not accepted', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/assets/index-B2nQZ0s0.js',
      headers: { 'accept-encoding': 'gzip' },
    })

    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['cache-control']).toBe('public,max-age=31536000,immutable')
    expect(gunzipSync(res.rawPayload).toString()).toBe(hashedJs)
  })

  it('serves the identity file without Accept-Encoding', async () => {
    const res = await app.inject({ method: 'GET', path: '/assets/index-B2nQZ0s0.js' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.headers.vary).toMatch(/accept-encoding/i)
    expect(res.headers['cache-control']).toBe('public,max-age=31536000,immutable')
    expect(res.body).toBe(hashedJs)
  })

  it('serves the service worker as a script that always revalidates', async () => {
    const res = await app.inject({ method: 'GET', path: '/sw.js' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/javascript/)
    // A cached worker would keep an old UI's cache rules alive after an update
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('keeps unhashed files revalidating when served precompressed', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/manifest.json',
      headers: { 'accept-encoding': 'br' },
    })

    expect(res.headers['content-encoding']).toBe('br')
    expect(res.headers['content-type']).toMatch(/json/)
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('scripts/precompress.mjs writes variants for large text files only and drops stale ones', async () => {
    const dir = resolve(testStoragePath, 'precompress')
    const big = 'body { color: red; }\n'.repeat(200)
    await ensureDir(dir)
    await writeFile(resolve(dir, 'styles-PEDBJHIE.css'), big)
    await writeFile(resolve(dir, 'tiny.js'), 'x()')
    await writeFile(resolve(dir, 'font-7ICWWULB.woff2'), Buffer.alloc(4096))
    await writeFile(resolve(dir, 'gone-AAAAAAAA.js.br'), 'stale')

    await promisify(execFile)(process.execPath, [resolve(__dirname, '../../scripts/precompress.mjs'), dir])

    expect(brotliDecompressSync(await readFile(resolve(dir, 'styles-PEDBJHIE.css.br'))).toString()).toBe(big)
    expect(gunzipSync(await readFile(resolve(dir, 'styles-PEDBJHIE.css.gz'))).toString()).toBe(big)
    expect(await stat(resolve(dir, 'tiny.js.br')).catch(() => null)).toBeNull()
    expect(await stat(resolve(dir, 'font-7ICWWULB.woff2.br')).catch(() => null)).toBeNull()
    expect(await stat(resolve(dir, 'gone-AAAAAAAA.js.br')).catch(() => null)).toBeNull()
  })
})
