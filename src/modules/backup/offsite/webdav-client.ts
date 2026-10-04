/**
 * A minimal WebDAV client (Nextcloud, ownCloud, Synology, Apache mod_dav…):
 * upload, list and delete the files of one folder, with HTTP Basic auth and
 * the global fetch.
 */

import type { RemoteDestination, RemoteFile } from './remote-destination.js'

import { Buffer } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

export interface WebDavConfig {
  /** The folder the backups go in, e.g. https://cloud.example.com/remote.php/dav/files/me/homebridge/ */
  url: string
  username: string
  password: string
}

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>
type FetchBody = FetchInit['body']

const TIMEOUT_MS = 30_000
/** An upload gets this long per MB on top of the base timeout. */
const UPLOAD_MS_PER_MB = 2_000

export class WebDavClient implements RemoteDestination {
  private readonly folder: URL

  constructor(private readonly config: WebDavConfig) {
    this.folder = new URL(config.url.endsWith('/') ? config.url : `${config.url}/`)
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra }
    if (this.config.username || this.config.password) {
      headers.authorization = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`
    }
    return headers
  }

  private fileUrl(name: string): URL {
    return new URL(encodeURIComponent(name), this.folder)
  }

  private async send(method: string, url: URL, init: { headers?: Record<string, string>, body?: FetchBody, timeoutMs?: number } = {}): Promise<Response> {
    const response = await fetch(url, {
      method,
      headers: this.headers(init.headers),
      body: init.body,
      redirect: 'error',
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
      ...(init.body ? { duplex: 'half' } : {}),
    } as FetchInit)
    if (!response.ok) {
      throw new Error(`WebDAV ${method} answered HTTP ${response.status}${response.status === 401 ? ' (check the user name and password)' : response.status === 404 ? ' (the folder does not exist)' : ''}`)
    }
    return response
  }

  async upload(localPath: string, name: string): Promise<void> {
    const { size } = await stat(localPath)
    await this.send('PUT', this.fileUrl(name), {
      headers: { 'content-type': 'application/gzip', 'content-length': String(size) },
      body: Readable.toWeb(createReadStream(localPath)) as unknown as FetchBody,
      timeoutMs: TIMEOUT_MS + Math.ceil(size / 1024 / 1024) * UPLOAD_MS_PER_MB,
    })
  }

  async list(): Promise<RemoteFile[]> {
    const response = await this.send('PROPFIND', this.folder, {
      headers: { 'depth': '1', 'content-type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>',
    })
    return parsePropfind(await response.text(), this.folder)
  }

  async delete(name: string): Promise<void> {
    await this.send('DELETE', this.fileUrl(name))
  }

  async test(): Promise<void> {
    await this.send('PROPFIND', this.folder, { headers: { depth: '0' } })
  }
}

/** The files (not folders) a Depth: 1 PROPFIND lists directly in `folder`. */
export function parsePropfind(xml: string, folder: URL): RemoteFile[] {
  const files: RemoteFile[] = []
  for (const [, block] of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
    const href = block.match(/<(?:[\w-]+:)?href[^>]*>([^<]+)<\/(?:[\w-]+:)?href>/i)?.[1]?.trim()
    if (!href || /<(?:[\w-]+:)?collection\s*\/?>/i.test(block)) {
      continue
    }
    const path = new URL(href.replace(/&amp;/g, '&'), folder).pathname
    if (!path.startsWith(folder.pathname) || path.length <= folder.pathname.length) {
      continue
    }
    const name = decodeURIComponent(path.slice(folder.pathname.length))
    if (name.includes('/')) {
      continue
    }
    files.push({ name, size: Number(block.match(/getcontentlength[^>]*>(\d+)</i)?.[1] ?? 0) })
  }
  return files
}
