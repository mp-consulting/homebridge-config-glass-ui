import type { MockInstance } from 'vitest'

import { vi } from 'vitest'

import { api, ApiError } from '@/core/api/api'

/**
 * Test-only stand-in for the api wrapper, ported from the Angular `fakeApi`.
 *
 * It spies on the methods of the real `api` object, so any module that imports
 * `api` sees the fake without a `vi.mock`:
 *
 *     const fake = fakeApi().respond('get', '/plugins', [plugin])
 *
 * Each call to `fakeApi()` starts again with no routes and no recorded calls.
 */

export type ApiMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'

export interface FakeApiCall {
  method: ApiMethod
  url: string
  body?: any
  options?: Record<string, any>
}

type Responder = (call: FakeApiCall) => any

interface Route {
  method: ApiMethod
  matcher: RegExp | string
  responder: Responder
  rejects: boolean
}

export interface FakeApiOptions {
  /** Reject calls with no registered response instead of resolving `undefined`. */
  strict?: boolean
}

export interface FakeApi {
  get: MockInstance
  post: MockInstance
  put: MockInstance
  patch: MockInstance
  delete: MockInstance
  calls: FakeApiCall[]
  /** Register a response; a later registration for the same method and url wins. */
  respond: (method: ApiMethod, url: RegExp | string, response: Responder | any) => FakeApi
  /** Register a rejection. */
  fail: (method: ApiMethod, url: RegExp | string, error: any) => FakeApi
  callsTo: (method: ApiMethod, url?: RegExp | string) => FakeApiCall[]
  lastCall: (method: ApiMethod, url?: RegExp | string) => FakeApiCall | undefined
  clearCalls: () => void
}

function matches(matcher: RegExp | string, url: string): boolean {
  return typeof matcher === 'string' ? matcher === url : matcher.test(url)
}

export function fakeApi(options: FakeApiOptions = {}): FakeApi {
  const routes: Route[] = []
  const calls: FakeApiCall[] = []

  const handle = (call: FakeApiCall): Promise<any> => {
    calls.push(call)
    let route: Route | undefined
    for (let i = routes.length - 1; i >= 0; i -= 1) {
      if (routes[i].method === call.method && matches(routes[i].matcher, call.url)) {
        route = routes[i]
        break
      }
    }
    if (!route) {
      return options.strict
        ? Promise.reject(new Error(`fakeApi: no response registered for ${call.method.toUpperCase()} ${call.url}`))
        : Promise.resolve(undefined)
    }
    try {
      const value = route.responder(call)
      return route.rejects ? Promise.reject(value) : Promise.resolve(value)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  const spy = (method: ApiMethod, withBody: boolean) => {
    const instance = vi.spyOn(api, method) as unknown as MockInstance
    instance.mockReset()
    instance.mockImplementation(((url: string, a?: any, b?: any) => withBody
      ? handle({ method, url, body: a, options: b })
      : handle({ method, url, options: a })) as any)
    return instance
  }

  const fake = {
    get: spy('get', false),
    delete: spy('delete', false),
    post: spy('post', true),
    put: spy('put', true),
    patch: spy('patch', true),
    calls,
  } as FakeApi

  const register = (method: ApiMethod, url: RegExp | string, response: any, rejects: boolean) => {
    const responder: Responder = typeof response === 'function' ? response : () => response
    routes.push({ method, matcher: url, responder, rejects })
    return fake
  }

  fake.respond = (method, url, response) => register(method, url, response, false)
  fake.fail = (method, url, error) => register(method, url, error, true)
  fake.callsTo = (method, url) => calls.filter(call => call.method === method && (url === undefined || matches(url, call.url)))
  fake.lastCall = (method, url) => fake.callsTo(method, url).at(-1)
  fake.clearCalls = () => {
    calls.length = 0
  }

  return fake
}

/**
 * An `ApiError` the way the backend fails a request: the server's message in
 * `error.message`, which is what `toToastMessage` surfaces.
 * @param message - the server's message
 * @param status - the HTTP status
 */
export function apiError(message: string, status = 500): ApiError {
  return new ApiError({ status, statusText: 'Internal Server Error', url: '/api', error: { message, statusCode: status } })
}
