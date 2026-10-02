import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, setUnauthorizedHandler } from '@/core/api/api'
import { getStoredToken, setStoredToken, tokenGetter } from '@/core/auth/token-store'
import { environment } from '@/environments/environment'

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>

interface Reply {
  status?: number
  statusText?: string
  body?: string | Blob
  headers?: Record<string, string>
}

/**
 * The api wrapper is the only place the app calls fetch for the backend, so
 * these are the assumptions every other spec's fake api stands in for: the base
 * url is prefixed, the body and options go through, a failure reaches the
 * caller with the HttpErrorResponse shape, the bearer token goes where it
 * should and nowhere else, and an unexpected 401 ends the session.
 */
describe('api', () => {
  const base = environment.api.base
  let fetchMock: ReturnType<typeof vi.fn>
  let reply: Reply

  function lastRequest(): { url: string, init: FetchInit, headers: Headers } {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, FetchInit]
    return { url, init, headers: new Headers(init.headers) }
  }

  beforeEach(() => {
    reply = { body: JSON.stringify({ ok: true }) }
    fetchMock = vi.fn(async () => new Response(reply.body ?? null, {
      status: reply.status ?? 200,
      statusText: reply.statusText ?? 'OK',
      headers: reply.headers,
    }))
    vi.stubGlobal('fetch', fetchMock)
    setStoredToken(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setStoredToken(null)
    setUnauthorizedHandler(null)
  })

  describe('requests', () => {
    it.each([
      ['get', () => api.get('/status')],
      ['delete', () => api.delete('/status')],
    ])('sends a %s to the api base', async (method, call) => {
      await expect(call()).resolves.toEqual({ ok: true })

      expect(lastRequest().url).toBe(`${base}/status`)
      expect(lastRequest().init.method).toBe(method.toUpperCase())
    })

    it.each([
      ['post', () => api.post('/users', { username: 'admin' })],
      ['put', () => api.put('/users', { username: 'admin' })],
      ['patch', () => api.patch('/users', { username: 'admin' })],
    ])('sends a %s with its json body to the api base', async (method, call) => {
      reply.body = JSON.stringify({ id: 1 })

      await expect(call()).resolves.toEqual({ id: 1 })

      const { url, init, headers } = lastRequest()
      expect(url).toBe(`${base}/users`)
      expect(init.method).toBe(method.toUpperCase())
      expect(init.body).toBe(JSON.stringify({ username: 'admin' }))
      expect(headers.get('Content-Type')).toBe('application/json')
    })

    it('sends a delete body from the options', async () => {
      // Four of the destructive modals send their payload this way
      await api.delete('/server/cached-accessories', { body: [{ uuid: 'a' }] })

      expect(lastRequest().init.body).toBe(JSON.stringify([{ uuid: 'a' }]))
    })

    it('adds the query parameters, leaving out empty ones', async () => {
      await api.get('/plugins/install', { params: { version: '1.2.3', beta: true, skip: undefined } })

      expect(lastRequest().url).toBe(`${base}/plugins/install?version=1.2.3&beta=true`)
    })

    it('sends the credentials the environment asks for', async () => {
      await api.post('/auth/session', {}, { withCredentials: true })

      expect(lastRequest().init.credentials).toBe(environment.apiCredentials)
    })

    it('resolves null for an empty json body', async () => {
      reply.body = ''

      await expect(api.post('/auth/logout', {})).resolves.toBeNull()
    })

    it('reads a text response', async () => {
      reply.body = 'plain log'

      await expect(api.get('/log', { responseType: 'text' })).resolves.toBe('plain log')
    })

    it('resolves the whole response when asked to observe it', async () => {
      // The backup and log downloads read the file name from the headers
      reply = { body: new Blob(['backup']), headers: { 'Content-Disposition': 'attachment; filename="backup.tar.gz"' } }

      const response = await api.get('/backup/download', { observe: 'response', responseType: 'blob' })

      expect(response.body).toBeInstanceOf(Blob)
      expect(response.headers.get('Content-Disposition')).toContain('backup.tar.gz')
      expect(response.status).toBe(200)
    })
  })

  describe('failures', () => {
    it('rejects with the error body the server sent', async () => {
      // Every consumer's error path reads err.error.message off this, and the
      // http error helper decides what the user sees from the same shape
      reply = { status: 409, statusText: 'Conflict', body: JSON.stringify({ message: 'Username already taken' }) }

      const error: ApiError = await api.post('/users', {}).catch(err => err)

      expect(error).toBeInstanceOf(ApiError)
      expect(error.status).toBe(409)
      expect(error.statusText).toBe('Conflict')
      expect(error.error).toEqual({ message: 'Username already taken' })
      expect(error.message).toBe(`Http failure response for ${base}/users: 409 Conflict`)
    })

    it('keeps a non-json error body as text', async () => {
      reply = { status: 502, statusText: 'Bad Gateway', body: 'upstream down' }

      await expect(api.get('/status')).rejects.toMatchObject({ status: 502, error: 'upstream down' })
    })

    it('reports status 0 when the server cannot be reached', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      await expect(api.get('/status')).rejects.toMatchObject({ status: 0, statusText: 'Unknown Error' })
    })
  })

  /**
   * ⚠️ The token is a bearer credential for every admin API on the box,
   * including the terminal socket. Third parties (the weather widget) are
   * fetched directly, never through this wrapper, so it can only ever send the
   * token to the homebridge api.
   */
  describe('the access token', () => {
    it('is sent with a lowercase bearer scheme, which is what the server parses', async () => {
      setStoredToken('a-real-token')

      await api.get('/status/homebridge')

      expect(lastRequest().headers.get('Authorization')).toBe('bearer a-real-token')
    })

    it('is left off entirely when there is none', async () => {
      // Not `bearer null` - the server would read that as a malformed token
      await api.get('/auth/settings')

      expect(lastRequest().headers.has('Authorization')).toBe(false)
    })

    it('is picked up again once the user signs in', async () => {
      await api.get('/status/homebridge')
      expect(lastRequest().headers.has('Authorization')).toBe(false)

      setStoredToken('signed-in-now')
      await api.get('/status/homebridge')

      expect(lastRequest().headers.get('Authorization')).toBe('bearer signed-in-now')
    })

    it('is left off the login request', async () => {
      setStoredToken('an-old-token')

      await api.post('/auth/login', { username: 'admin', password: 'x' })

      expect(lastRequest().headers.has('Authorization')).toBe(false)
    })
  })

  describe('the token store', () => {
    it('reads the token held in memory', () => {
      setStoredToken('in-memory')

      expect(tokenGetter()).toBe('in-memory')
    })

    it('reports nothing once the token is cleared', () => {
      setStoredToken('in-memory')
      setStoredToken(null)

      expect(tokenGetter()).toBeNull()
    })

    it('never falls back to local storage', () => {
      // Where the token used to live, and the reason it moved
      window.localStorage.setItem('access_token', 'left-over-from-an-old-version')
      setStoredToken(null)

      expect(tokenGetter()).toBeNull()
      expect(getStoredToken()).toBeNull()
    })
  })

  describe('an unexpected 401', () => {
    let onUnauthorized: ReturnType<typeof vi.fn<() => void>>

    beforeEach(() => {
      onUnauthorized = vi.fn()
      setUnauthorizedHandler(onUnauthorized)
    })

    it('signs the user out when an authorised request is rejected', async () => {
      reply = { status: 401, statusText: 'Unauthorized', body: '{}' }

      await expect(api.get('/plugins')).rejects.toBeDefined()

      expect(onUnauthorized).toHaveBeenCalledTimes(1)
    })

    it('still passes the error on to the caller', async () => {
      // The caller's own error handling has to keep running, so the page can
      // show something while the reload happens
      reply = { status: 401, statusText: 'Unauthorized', body: JSON.stringify({ message: 'nope' }) }

      await expect(api.get('/plugins')).rejects.toMatchObject({ status: 401 })
    })

    it.each([
      ['/auth/login'],
      ['/auth/noauth'],
      ['/auth/check'],
    ])('leaves %s alone', async (path) => {
      // These legitimately answer 401 - a wrong password is not a dead session
      reply = { status: 401, statusText: 'Unauthorized', body: '{}' }

      await expect(api.post(path, {})).rejects.toBeDefined()

      expect(onUnauthorized).not.toHaveBeenCalled()
    })

    it('leaves /auth/refresh to decide its own logout', async () => {
      // ⚠️ #2981. Logging out from here would send the ACCOUNT-WIDE logout with
      // a token the server honours. refreshSession() asks for a browser-local
      // logout instead.
      reply = { status: 401, statusText: 'Unauthorized', body: '{}' }

      await expect(api.post('/auth/refresh', {})).rejects.toBeDefined()

      expect(onUnauthorized).not.toHaveBeenCalled()
    })

    it.each([403, 404, 500])('ignores a %s', async (status) => {
      reply = { status, statusText: 'Error', body: '{}' }

      await expect(api.get('/plugins')).rejects.toBeDefined()

      expect(onUnauthorized).not.toHaveBeenCalled()
    })
  })
})
