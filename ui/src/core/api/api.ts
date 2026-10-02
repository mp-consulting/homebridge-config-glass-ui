import { getStoredToken } from '@/core/auth/token-store'
import { environment } from '@/environments/environment'

/**
 * The fetch wrapper every part of the app reaches the server through.
 *
 * Replaces ApiService + HttpClient + the JwtModule interceptor + the auth error
 * interceptor. Paths are relative to the api base (`/status`, not `/api/status`),
 * and failures reject with an ApiError shaped like Angular's HttpErrorResponse
 * (`status`, `statusText`, `error`, `message`), because every consumer's error
 * path reads `err.error.message` and `err.status` off it.
 */

export type ApiResponseType = 'json' | 'text' | 'blob'

export type ApiParams = Record<string, string | number | boolean | null | undefined>

export interface ApiOptions {
  /** Query string parameters; `null` / `undefined` values are left out. */
  params?: ApiParams
  /** How to read the response body. Defaults to json. */
  responseType?: ApiResponseType
  headers?: Record<string, string>
  /** `'response'` resolves with the whole response (headers, status) instead of the body. */
  observe?: 'body' | 'response'
  /** Request body for a DELETE (the destructive modals send their payload this way). */
  body?: unknown
  /**
   * Kept so calls ported from Angular still type-check. Credentials always come
   * from `environment.apiCredentials`, which already sends the cookies.
   */
  withCredentials?: boolean
  signal?: AbortSignal
}

/** What `observe: 'response'` resolves with - the parts of HttpResponse callers read. */
export interface ApiResponse<T> {
  body: T
  headers: Headers
  status: number
  statusText: string
  ok: boolean
  url: string
}

/**
 * A failed request. The same fields as Angular's HttpErrorResponse.
 * `status` is 0 when the server could not be reached at all.
 */
export class ApiError extends Error {
  public override readonly name = 'HttpErrorResponse'
  public readonly ok = false
  public readonly status: number
  public readonly statusText: string
  public readonly url: string
  public readonly error: any
  public readonly headers?: Headers

  constructor(init: { status: number, statusText: string, url: string, error: any, headers?: Headers }) {
    super(init.status >= 200 && init.status < 300
      ? `Http failure during parsing for ${init.url}`
      : `Http failure response for ${init.url}: ${init.status} ${init.statusText}`)
    this.status = init.status
    this.statusText = init.statusText
    this.url = init.url
    this.error = init.error
    this.headers = init.headers
  }
}

/**
 * Requests that legitimately answer 401 without the session being dead, so the
 * 401 rule below leaves them alone.
 *
 * Login / noauth / check: a wrong password, a missing setup wizard, a deliberate
 * token probe.
 *
 * Refresh is skipped for a different reason: it is the one endpoint that refuses
 * a token the guard still accepts. `validateUser()` never looks at
 * `sessionStartedAt`, so a token past the 30-day renewal cap authorises normally
 * and only `refreshToken()` rejects it - at which point an account-wide logout
 * would be sent holding a token the server honours, and one device reaching the
 * cap would sign the user out everywhere (#2981). `refreshSession()` owns that
 * decision and asks for a local logout itself.
 */
const SKIP_401_PATHS = [
  '/auth/login',
  '/auth/noauth',
  '/auth/check',
  '/auth/refresh',
]

/** The login request must go out bare: a stale token on it is what the user is trying to get out of. */
const NO_TOKEN_PATHS = ['/auth/login']

let unauthorizedHandler: (() => void) | null = null

/**
 * Register what happens when an authorised request comes back 401: the auth
 * store signs out (if it holds a token). Registered by the auth store rather
 * than imported here so the api module has no dependency on it.
 *
 * Before this rule existed only `checkToken()` reacted to the server
 * invalidating a session; every other call surfaced a 401 as a generic toast
 * and the user kept clicking buttons that no longer did anything.
 * @param handler - called on every qualifying 401, or null to remove it
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

function buildUrl(path: string, params?: ApiParams): string {
  let url = `${environment.api.base}${path}`
  if (params) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        search.append(key, String(value))
      }
    }
    const query = search.toString()
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query
    }
  }
  return url
}

type FetchBody = NonNullable<Parameters<typeof fetch>[1]>['body']

function serialiseBody(body: unknown, headers: Headers): FetchBody | undefined {
  if (body === null || body === undefined) {
    return undefined
  }
  if (typeof body === 'string') {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'text/plain')
    }
    return body
  }
  if (body instanceof FormData || body instanceof Blob || body instanceof URLSearchParams || body instanceof ArrayBuffer) {
    return body
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return JSON.stringify(body)
}

/** Read an error body the way HttpClient does: json if it parses, else text. */
async function readErrorBody(response: Response): Promise<any> {
  const text = await response.text().catch(() => '')
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function readBody(response: Response, responseType: ApiResponseType, url: string): Promise<any> {
  if (responseType === 'blob') {
    return response.blob()
  }
  const text = await response.text()
  if (responseType === 'text') {
    return text
  }
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new ApiError({
      status: response.status,
      statusText: response.statusText,
      url,
      error: { error, text },
      headers: response.headers,
    })
  }
}

async function request<T>(method: string, path: string, body: unknown, options: ApiOptions = {}): Promise<T | ApiResponse<T>> {
  const url = buildUrl(path, options.params)
  const headers = new Headers(options.headers)

  // The token is read per request: it is set after the session exchange, not at
  // bootstrap. No token means no header at all - not `bearer null`, which the
  // server would read as a malformed token
  const token = getStoredToken()
  if (token && !headers.has('Authorization') && !NO_TOKEN_PATHS.some(skip => path.startsWith(skip))) {
    headers.set('Authorization', `bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: serialiseBody(body, headers),
      credentials: environment.apiCredentials,
      signal: options.signal,
    })
  } catch (error) {
    throw new ApiError({ status: 0, statusText: 'Unknown Error', url, error })
  }

  if (!response.ok) {
    const error = new ApiError({
      status: response.status,
      statusText: response.statusText,
      url,
      error: await readErrorBody(response),
      headers: response.headers,
    })
    if (response.status === 401 && !SKIP_401_PATHS.some(skip => url.includes(skip))) {
      unauthorizedHandler?.()
    }
    throw error
  }

  const responseBody = await readBody(response, options.responseType ?? 'json', url)
  if (options.observe === 'response') {
    return {
      body: responseBody as T,
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      url,
    }
  }
  return responseBody as T
}

type ResponseOptions = ApiOptions & { observe: 'response' }

interface Api {
  get: {
    <T = any>(path: string, options: ResponseOptions): Promise<ApiResponse<T>>
    <T = any>(path: string, options?: ApiOptions): Promise<T>
  }
  delete: {
    <T = any>(path: string, options: ResponseOptions): Promise<ApiResponse<T>>
    <T = any>(path: string, options?: ApiOptions): Promise<T>
  }
  post: {
    <T = any>(path: string, body: unknown, options: ResponseOptions): Promise<ApiResponse<T>>
    <T = any>(path: string, body?: unknown, options?: ApiOptions): Promise<T>
  }
  put: {
    <T = any>(path: string, body: unknown, options: ResponseOptions): Promise<ApiResponse<T>>
    <T = any>(path: string, body?: unknown, options?: ApiOptions): Promise<T>
  }
  patch: {
    <T = any>(path: string, body: unknown, options: ResponseOptions): Promise<ApiResponse<T>>
    <T = any>(path: string, body?: unknown, options?: ApiOptions): Promise<T>
  }
}

/**
 * `get` and `delete` take options as their second argument and `post`, `put`,
 * `patch` take the body - the same signatures ApiService had, so ported calls
 * read the same. A DELETE body goes in `options.body`.
 */
export const api: Api = {
  get: ((path: string, options?: ApiOptions) => request('GET', path, undefined, options)) as Api['get'],
  delete: ((path: string, options?: ApiOptions) => request('DELETE', path, options?.body, options)) as Api['delete'],
  post: ((path: string, body?: unknown, options?: ApiOptions) => request('POST', path, body, options)) as Api['post'],
  put: ((path: string, body?: unknown, options?: ApiOptions) => request('PUT', path, body, options)) as Api['put'],
  patch: ((path: string, body?: unknown, options?: ApiOptions) => request('PATCH', path, body, options)) as Api['patch'],
}
