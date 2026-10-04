import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { RequestMethod, ValidationPipe } from '@nestjs/common'
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js'
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy } from 'fs-extra'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module.js'
import { AdminGuard } from '../../src/core/auth/guards/admin.guard.js'
import { testStoragePath } from '../storage-path.js'

/**
 * Every HTTP route in the app, as discovered from the Nest metadata, is either
 * behind AdminGuard (and must answer 403 to a logged-in non-admin user) or is
 * listed below on purpose. A new route that is neither fails this spec.
 */

// Routes that are deliberately reachable without AdminGuard: public auth
// endpoints, read-only data every user sees, routes that check the user
// themselves, and the current user's own account actions. Adding to this list
// needs a reason.
const UNGUARDED_ALLOW_LIST = new Set([
  'GET /',
  // ai: any user sees whether the Assistant is on (admins also get its
  // settings, never the key); the chat's tools run with the user's own
  // short-lived token, read-only tools only for a non-admin
  'GET /ai/status',
  'POST /ai/chat',
  // auth: public or session endpoints
  'GET /auth/check',
  'GET /auth/settings',
  'GET /auth/wallpaper/:hash',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/noauth',
  'POST /auth/refresh',
  'POST /auth/session',
  // accessories: every user can see and control accessories, and has a layout
  'GET /accessories',
  'GET /accessories/:uniqueId',
  'GET /accessories/layout',
  'GET /accessories/:uniqueId/history',
  'PUT /accessories/:uniqueId',
  // scenes: every user can list and run them, as every user can control accessories
  'GET /scenes',
  'POST /scenes/:id/run',
  // plugins: the handler rejects `include=config` for non-admins itself
  'GET /plugins',
  // plugin custom UI: gated by a single-use ticket (issued to admins) and the
  // per-plugin asset session cookie, not by a bearer token
  'GET /plugins/settings-ui/:pluginName/*',
  'GET /plugins/settings-ui/:pluginName/index.html',
  // setup wizard: protected by its own "no users yet" check
  'GET /setup-wizard/get-setup-wizard-token',
  'POST /setup-wizard/create-first-user',
  // status: dashboard widgets every user sees
  'GET /status/cpu',
  'GET /status/ram',
  'GET /status/network',
  'GET /status/uptime',
  'GET /status/homebridge',
  'GET /status/homebridge/child-bridges',
  'GET /status/homebridge-version',
  'GET /status/server-information',
  'GET /status/nodejs',
  'GET /status/rpi/throttled',
  // users: the current user's own account
  'POST /users/change-password',
  'POST /users/otp/setup',
  'POST /users/otp/activate',
  'POST /users/otp/deactivate',
])

interface DiscoveredRoute {
  key: string
  method: string
  path: string
  admin: boolean
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .flatMap(p => p.split('/'))
    .filter(Boolean)
    .join('/')
  return `/${joined}`
}

function discoverRoutes(moduleRef: TestingModule): DiscoveredRoute[] {
  const discovery = moduleRef.get(DiscoveryService)
  const scanner = moduleRef.get(MetadataScanner)
  const reflector = moduleRef.get(Reflector)
  const routes: DiscoveredRoute[] = []

  for (const wrapper of discovery.getControllers()) {
    const { metatype, instance } = wrapper
    if (!metatype || !instance) {
      continue
    }
    const controllerPaths = [].concat(Reflect.getMetadata(PATH_METADATA, metatype) ?? '/') as string[]
    const classGuards: unknown[] = reflector.get(GUARDS_METADATA, metatype) ?? []
    const prototype = Object.getPrototypeOf(instance)

    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[methodName]
      const handlerPaths = Reflect.getMetadata(PATH_METADATA, handler)
      if (handlerPaths === undefined) {
        continue
      }
      const requestMethod: RequestMethod = Reflect.getMetadata(METHOD_METADATA, handler) ?? RequestMethod.GET
      const handlerGuards: unknown[] = reflector.get(GUARDS_METADATA, handler) ?? []
      const admin = [...classGuards, ...handlerGuards].includes(AdminGuard)

      for (const controllerPath of controllerPaths) {
        for (const handlerPath of [].concat(handlerPaths) as string[]) {
          const method = RequestMethod[requestMethod]
          const path = joinPath(controllerPath, handlerPath)
          routes.push({ key: `${method} ${path}`, method, path, admin })
        }
      }
    }
  }
  return routes
}

// `:param` -> a harmless placeholder, `*` -> a single segment
function fillParams(path: string): string {
  return path.replace(/:[^/]+/g, 'placeholder').replace(/\*/g, 'placeholder')
}

describe('AdminGuard route matrix (e2e)', () => {
  let app: NestFastifyApplication
  let routes: DiscoveredRoute[]
  let userAuthorization: string

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      skipMissingProperties: true,
    }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    routes = discoverRoutes(moduleFixture)

    // Create a non-admin user through the API, then log in as them
    const adminAuthorization = `bearer ${(await app.inject({
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
      throw new Error(`could not create the non-admin user: ${created.statusCode} ${created.body}`)
    }

    const login = await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'regular', password: 'regular-password' },
    })
    if (login.statusCode !== 201) {
      throw new Error(`non-admin login failed: ${login.statusCode} ${login.body}`)
    }
    userAuthorization = `bearer ${login.json().access_token}`
  })

  afterAll(async () => {
    await app.close()
  })

  it('discovers the app routes', () => {
    expect(routes.length).toBeGreaterThan(50)
    expect(routes.filter(r => r.admin).length).toBeGreaterThan(30)
  })

  it('the non-admin token is valid (so the 403s below come from AdminGuard, not auth)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/auth/check',
      headers: { authorization: userAuthorization },
    })
    expect(res.statusCode).toBe(200)
  })

  it('every route without AdminGuard is on the explicit allow-list', () => {
    const unguarded = routes.filter(r => !r.admin).map(r => r.key).sort()
    const unexpected = unguarded.filter(key => !UNGUARDED_ALLOW_LIST.has(key))
    expect(unexpected, 'new route(s) without AdminGuard: add the guard, or add them to UNGUARDED_ALLOW_LIST with a reason').toEqual([])
  })

  it('the allow-list has no stale entries', () => {
    const unguarded = new Set(routes.filter(r => !r.admin).map(r => r.key))
    const stale = [...UNGUARDED_ALLOW_LIST].filter(key => !unguarded.has(key))
    expect(stale).toEqual([])
  })

  it('every AdminGuard route answers 403 to a non-admin user', async () => {
    const failures: string[] = []
    for (const route of routes.filter(r => r.admin)) {
      const res = await app.inject({
        method: route.method as any,
        url: fillParams(route.path),
        headers: { authorization: userAuthorization },
        ...(['POST', 'PUT', 'PATCH'].includes(route.method) ? { payload: {} } : {}),
      })
      if (res.statusCode !== 403) {
        failures.push(`${route.key} -> ${res.statusCode}`)
      }
    }
    expect(failures).toEqual([])
  })
})
