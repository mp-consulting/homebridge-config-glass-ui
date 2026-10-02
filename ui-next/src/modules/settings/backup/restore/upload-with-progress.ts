import { ApiError } from '@/core/api'
import { getStoredToken } from '@/core/auth/token-store'
import { environment } from '@/environments/environment'

/**
 * POST a form to the api, reporting upload progress. `fetch` has no upload
 * progress, so this goes through XMLHttpRequest (what HttpClient's
 * `reportProgress` used). The rest matches `api.post`: same base url, bearer
 * token and credentials, the response read as json if it parses, and an
 * `ApiError` on a non-2xx status or a network failure.
 * @param path - relative to the api base, e.g. `/backup/restore/hbfx`
 * @param body - the form to send
 * @param onProgress - called with the bytes sent so far and the total
 */
export function uploadWithProgress<T = unknown>(path: string, body: FormData, onProgress: (loaded: number, total: number) => void): Promise<T> {
  const url = `${environment.api.base}${path}`
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = environment.apiCredentials === 'include'
    const token = getStoredToken()
    if (token) {
      xhr.setRequestHeader('Authorization', `bearer ${token}`)
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total) {
        onProgress(event.loaded, event.total)
      }
    }
    const parse = () => {
      const text = xhr.responseText
      if (!text) {
        return null
      }
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parse() as T)
      } else {
        reject(new ApiError({ status: xhr.status, statusText: xhr.statusText, url, error: parse() }))
      }
    }
    xhr.onerror = () => {
      reject(new ApiError({ status: 0, statusText: 'Unknown Error', url, error: null }))
    }
    xhr.send(body)
  })
}
