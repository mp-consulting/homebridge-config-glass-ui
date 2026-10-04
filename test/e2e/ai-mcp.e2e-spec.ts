import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { HttpService } from '@nestjs/axios'
import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, readJson, remove, writeJson } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiTokenService } from '../../src/core/auth/api-token.service.js'
import { Logger } from '../../src/core/logger/logger.service.js'
import { MCP_API_TOKEN_NAME } from '../../src/modules/ai/ai-mcp.service.js'
import { AiModule } from '../../src/modules/ai/ai.module.js'
import { testStoragePath } from '../storage-path.js'

describe('Assistant MCP server settings (e2e)', () => {
  let app: NestFastifyApplication
  let adminAuth: string
  let userAuth: string
  let apiTokens: ApiTokenService
  const configPath = resolve(testStoragePath, 'config.json')

  async function login(username: string) {
    const res = await app.inject({ method: 'POST', path: '/auth/login', payload: { username, password: 'admin' } })
    return `bearer ${res.json().access_token}`
  }

  function inject(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, auth: string, payload?: unknown) {
    return app.inject({ method, path, headers: { authorization: auth }, ...(payload === undefined ? {} : { payload: payload as any }) })
  }

  /** The `mcp.http` part of the HomebridgeAiKit block in config.json. */
  async function storedHttp(): Promise<Record<string, any> | undefined> {
    const config = await readJson(configPath)
    return config.platforms.find((p: any) => p.platform === 'HomebridgeAiKit')?.mcp?.http
  }

  async function aiBlock(): Promise<Record<string, any> | undefined> {
    const config = await readJson(configPath)
    return config.platforms.find((p: any) => p.platform === 'HomebridgeAiKit')
  }

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = configPath
    process.env.UIX_CUSTOM_PLUGIN_PATH = resolve(testStoragePath, 'plugins/node_modules')

    await copy(resolve(__dirname, '../mocks', 'config.json'), configPath)
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))
    const [admin] = await readJson(resolve(__dirname, '../mocks', 'auth.json'))
    await writeJson(resolve(testStoragePath, 'auth.json'), [admin, { ...admin, id: 2, username: 'user', name: 'User', admin: false }])

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AiModule],
    })
      .overrideProvider(HttpService)
      .useValue(new HttpService())
      .compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    apiTokens = app.get(ApiTokenService)
  })

  beforeEach(async () => {
    adminAuth ??= await login('admin')
    userAuth ??= await login('user')
    // No AI block and no API tokens at the start of each test
    const config = await readJson(configPath)
    config.platforms = config.platforms.filter((p: any) => p.platform !== 'HomebridgeAiKit')
    await writeJson(configPath, config, { spaces: 4 })
    await remove(apiTokens.tokensPath)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  it('reports the defaults and placeholder snippets without a block', async () => {
    const res = await inject('GET', '/ai/mcp?origin=https://homebridge.local:8581', adminAuth)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.http).toMatchObject({
      enabled: false,
      host: '127.0.0.1',
      port: 8582,
      url: 'http://127.0.0.1:8582/mcp',
      hasToken: false,
      homebridgeUrl: '',
      homebridgeToken: { set: false, id: null, scope: null, exists: null },
    })
    expect(body.snippets.http.claudeCode).toContain('<your MCP token>')
    expect(body.snippets.stdio.cursor).toContain('https://homebridge.local:8581')
    expect(body.snippets.stdio.claudeDesktop).toContain('"mcp"')
    // GET does not create the block
    expect(await aiBlock()).toBeUndefined()
  })

  it('ignores an origin that is not a plain http(s) address', async () => {
    const res = await inject('GET', '/ai/mcp?origin=javascript:alert(1)', adminAuth)
    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.json().snippets)).not.toContain('javascript')
  })

  it('saves enabled, host, port and the UI address, with the Assistant left off in a new block', async () => {
    const res = await inject('PUT', '/ai/mcp', adminAuth, { enabled: true, host: '0.0.0.0', port: 9000, homebridgeUrl: 'http://192.168.1.10:8581/' })

    expect(res.statusCode).toBe(200)
    expect(await aiBlock()).toMatchObject({ name: 'AI Kit', enabled: false, mcp: { http: { enabled: true, host: '0.0.0.0', port: 9000, homebridgeUrl: 'http://192.168.1.10:8581' } } })

    // A wildcard bind address shows as the host the browser used
    const status = (await inject('GET', '/ai/mcp?origin=http://nas.local:8581', adminAuth)).json()
    expect(status.http.url).toBe('http://nas.local:9000/mcp')
    expect(status.snippets.http.cursor).toContain('http://nas.local:9000/mcp')

    // Keeps the rest of an existing block
    expect((await inject('PUT', '/ai/mcp', adminAuth, { homebridgeUrl: '' })).statusCode).toBe(200)
    expect(await storedHttp()).toEqual({ enabled: true, host: '0.0.0.0', port: 9000 })
  })

  it('validates host, port and the UI address', async () => {
    expect((await inject('PUT', '/ai/mcp', adminAuth, { port: 0 })).statusCode).toBe(400)
    expect((await inject('PUT', '/ai/mcp', adminAuth, { port: 70000 })).statusCode).toBe(400)
    expect((await inject('PUT', '/ai/mcp', adminAuth, { port: 'x' })).statusCode).toBe(400)
    expect((await inject('PUT', '/ai/mcp', adminAuth, { host: 'http://evil/' })).statusCode).toBe(400)
    expect((await inject('PUT', '/ai/mcp', adminAuth, { host: 'a b' })).statusCode).toBe(400)
    expect((await inject('PUT', '/ai/mcp', adminAuth, { homebridgeUrl: 'ftp://x' })).statusCode).toBe(400)
    expect((await inject('PUT', '/ai/mcp', adminAuth, { token: 'short' })).statusCode).toBe(400)
    // The UI's own port (8080 in the mock config)
    const own = await inject('PUT', '/ai/mcp', adminAuth, { port: 8080 })
    expect(own.statusCode).toBe(400)
    expect(own.json().message).toContain('Glass UI listens on')
    expect(await aiBlock()).toBeUndefined()
  })

  it('generates a client token, shows it once and never returns it again', async () => {
    const warn = vi.spyOn(app.get(Logger, { strict: false }), 'warn')
    const res = await inject('POST', '/ai/mcp/token?origin=http://nas.local:8581', adminAuth)

    expect(res.statusCode).toBe(201)
    const { token, snippets, status } = res.json()
    expect(token).toMatch(/^[\w-]{43}$/)
    expect(snippets.claudeCode).toContain(`Authorization: Bearer ${token}`)
    expect(snippets.cursor).toContain(token)
    expect(status.http.hasToken).toBe(true)
    expect((await storedHttp())?.token).toBe(token)

    const later = await inject('GET', '/ai/mcp', adminAuth)
    expect(later.payload).not.toContain(token)
    expect(later.json().http.hasToken).toBe(true)
    // Nor in the Assistant status
    expect((await inject('GET', '/ai/status', adminAuth)).payload).not.toContain(token)
    // Nor in the log
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token)
  })

  it('regenerates a different token, and clears it', async () => {
    const first = (await inject('POST', '/ai/mcp/token', adminAuth)).json().token
    const second = (await inject('POST', '/ai/mcp/token', adminAuth)).json().token

    expect(second).not.toBe(first)
    expect((await storedHttp())?.token).toBe(second)

    const cleared = await inject('DELETE', '/ai/mcp/token', adminAuth)
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().http.hasToken).toBe(false)
    expect((await storedHttp())?.token).toBeUndefined()
  })

  it('stores a pasted client token without returning it', async () => {
    const res = await inject('PUT', '/ai/mcp', adminAuth, { token: 'my-own-token-0123456789' })
    expect(res.statusCode).toBe(200)
    expect(res.payload).not.toContain('my-own-token-0123456789')
    expect(res.json().http.hasToken).toBe(true)
    expect((await storedHttp())?.token).toBe('my-own-token-0123456789')
  })

  it('creates the MCP server\'s API token, stores it, and revokes it when replaced or removed', async () => {
    const res = await inject('POST', '/ai/mcp/homebridge-token', adminAuth, { scope: 'read' })

    expect(res.statusCode).toBe(201)
    const http = await storedHttp()
    expect(http?.homebridgeToken).toMatch(/^hbg_/)
    expect(res.payload).not.toContain(http?.homebridgeToken)
    expect(http?.homebridgeUrl).toBe('http://127.0.0.1:8080')
    const [first] = await apiTokens.list()
    expect(first).toMatchObject({ id: http?.homebridgeTokenId, name: MCP_API_TOKEN_NAME, scope: 'read', expiresAt: null, createdBy: 'admin' })
    expect(res.json().http.homebridgeToken).toEqual({ set: true, id: first.id, scope: 'read', exists: true })
    // It works: a read token, as a non-admin
    expect(await apiTokens.validate(http!.homebridgeToken)).toMatchObject({ admin: false })

    // Replace with an admin token: the old one is revoked
    const replaced = await inject('POST', '/ai/mcp/homebridge-token', adminAuth, { scope: 'admin' })
    expect(replaced.statusCode).toBe(201)
    const tokens = await apiTokens.list()
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ scope: 'admin', id: (await storedHttp())?.homebridgeTokenId })
    expect(await apiTokens.validate(http!.homebridgeToken)).toBeNull()

    // Remove: revoked and gone from the block
    const removed = await inject('DELETE', '/ai/mcp/homebridge-token', adminAuth)
    expect(removed.statusCode).toBe(200)
    expect(removed.json().http.homebridgeToken).toEqual({ set: false, id: null, scope: null, exists: null })
    expect(await apiTokens.list()).toEqual([])
    const after = await storedHttp()
    expect(after?.homebridgeToken).toBeUndefined()
    expect(after?.homebridgeTokenId).toBeUndefined()
  })

  it('reports an MCP API token revoked elsewhere, and replaces it', async () => {
    await inject('POST', '/ai/mcp/homebridge-token', adminAuth, { scope: 'read' })
    await apiTokens.revoke((await storedHttp())!.homebridgeTokenId)

    const status = (await inject('GET', '/ai/mcp', adminAuth)).json()
    expect(status.http.homebridgeToken).toMatchObject({ set: true, exists: false, scope: null })

    expect((await inject('POST', '/ai/mcp/homebridge-token', adminAuth, { scope: 'read' })).statusCode).toBe(201)
    expect(await apiTokens.list()).toHaveLength(1)
  })

  it('rejects a bad scope', async () => {
    expect((await inject('POST', '/ai/mcp/homebridge-token', adminAuth, { scope: 'root' })).statusCode).toBe(400)
    expect((await inject('POST', '/ai/mcp/homebridge-token', adminAuth, {})).statusCode).toBe(400)
    expect(await apiTokens.list()).toEqual([])
  })

  it('is for administrators only', async () => {
    for (const [method, path] of [['GET', '/ai/mcp'], ['PUT', '/ai/mcp'], ['POST', '/ai/mcp/token'], ['DELETE', '/ai/mcp/token'], ['POST', '/ai/mcp/homebridge-token'], ['DELETE', '/ai/mcp/homebridge-token']] as const) {
      expect((await inject(method, path, userAuth, method === 'GET' || method === 'DELETE' ? undefined : { scope: 'read' })).statusCode).toBe(403)
    }
    expect((await app.inject({ method: 'GET', path: '/ai/mcp' })).statusCode).toBe(401)
    expect(await aiBlock()).toBeUndefined()
  })

  it('refuses API tokens, even an admin one', async () => {
    const { token } = await apiTokens.create({ name: 'script', scope: 'admin' })
    const auth = `Bearer ${token}`

    const get = await inject('GET', '/ai/mcp', auth)
    expect(get.statusCode).toBe(403)
    expect(get.json().message).toContain('Sign in to Glass UI')
    expect((await inject('POST', '/ai/mcp/token', auth)).statusCode).toBe(403)
    expect((await inject('POST', '/ai/mcp/homebridge-token', auth, { scope: 'admin' })).statusCode).toBe(403)
    expect(await aiBlock()).toBeUndefined()
    expect(await apiTokens.list()).toHaveLength(1)
  })
})
