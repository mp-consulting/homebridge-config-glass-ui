import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/core/api'
import { setStoredToken } from '@/core/auth/token-store'

import { uploadWithProgress } from './upload-with-progress'

/** A stand-in XMLHttpRequest the spec answers by hand. */
class FakeXhr {
  public static last: FakeXhr
  public method = ''
  public url = ''
  public headers: Record<string, string> = {}
  public withCredentials = false
  public status = 0
  public statusText = ''
  public responseText = ''
  public body: unknown
  public upload: { onprogress: ((event: { lengthComputable: boolean, loaded: number, total: number }) => void) | null } = { onprogress: null }
  public onload: (() => void) | null = null
  public onerror: (() => void) | null = null

  constructor() {
    FakeXhr.last = this
  }

  public open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  public setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  public send(body: unknown) {
    this.body = body
  }

  public respond(status: number, text: string, statusText = '') {
    this.status = status
    this.statusText = statusText
    this.responseText = text
    this.onload?.()
  }
}

/**
 * The hbfx upload. It has to report progress (fetch cannot) and, the reason it
 * exists: resolve on the response, not on the first upload event.
 */
describe('uploadWithProgress', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the form to the api with the bearer token', () => {
    setStoredToken('abc')
    const form = new FormData()

    void uploadWithProgress('/backup/restore/hbfx', form, () => {})

    expect(FakeXhr.last.method).toBe('POST')
    expect(FakeXhr.last.url).toMatch(/\/api\/backup\/restore\/hbfx$/)
    expect(FakeXhr.last.headers.Authorization).toBe('bearer abc')
    expect(FakeXhr.last.body).toBe(form)
  })

  it('reports progress and resolves only on the response', async () => {
    const progress = vi.fn()
    let settled = false
    const upload = uploadWithProgress('/x', new FormData(), progress).then((value) => {
      settled = true
      return value
    })

    FakeXhr.last.upload.onprogress!({ lengthComputable: true, loaded: 5, total: 10 })
    await Promise.resolve()
    expect(progress).toHaveBeenCalledWith(5, 10)
    expect(settled).toBe(false)

    FakeXhr.last.respond(200, '{"status":"ok"}')
    await expect(upload).resolves.toEqual({ status: 'ok' })
  })

  it('rejects with an ApiError carrying the server message', async () => {
    const upload = uploadWithProgress('/x', new FormData(), () => {})

    FakeXhr.last.respond(400, '{"message":"not a valid hbfx file"}', 'Bad Request')

    const error = await upload.catch((e: unknown) => e) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.error.message).toBe('not a valid hbfx file')
  })

  it('rejects with status 0 when the server cannot be reached', async () => {
    const upload = uploadWithProgress('/x', new FormData(), () => {})

    FakeXhr.last.onerror!()

    await expect(upload).rejects.toMatchObject({ status: 0 })
  })
})
