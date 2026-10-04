/**
 * A minimal S3-compatible client (AWS S3, MinIO, Cloudflare R2, Backblaze B2,
 * Wasabi…): put, list and delete objects, signed with AWS Signature Version 4
 * on node:crypto and sent with the global fetch.
 */

import type { RemoteDestination, RemoteFile } from './remote-destination.js'

import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

export interface S3Config {
  /** https://s3.eu-west-1.amazonaws.com, https://<account>.r2.cloudflarestorage.com, http://minio.local:9000… */
  endpoint: string
  region: string
  bucket: string
  /** A folder inside the bucket, e.g. `homebridge/` (may be empty). */
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  /** `https://endpoint/bucket/key` (true) or `https://bucket.endpoint/key`. */
  forcePathStyle: boolean
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>
type FetchBody = FetchInit['body']

const TIMEOUT_MS = 30_000

/** RFC 3986 encoding as SigV4 wants it (encodeURIComponent leaves !'()* alone). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

/**
 * The SigV4 `Authorization` header for a request: its method, URL, and the
 * headers to sign (lower-case names; `host`, `x-amz-date` and
 * `x-amz-content-sha256` must be there), with the access key pair and region.
 */
export function signV4(
  request: { method: string, url: URL, headers: Record<string, string> },
  credentials: { accessKeyId: string, secretAccessKey: string, region: string, service?: string },
): string {
  const service = credentials.service ?? 's3'
  const amzDate = request.headers['x-amz-date']
  const day = amzDate.slice(0, 8)
  const names = Object.keys(request.headers).map(name => name.toLowerCase()).sort()
  const canonicalHeaders = names.map(name => `${name}:${String(request.headers[name]).trim().replace(/\s+/g, ' ')}\n`).join('')
  const signedHeaders = names.join(';')
  const query = [...request.url.searchParams.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const canonicalRequest = [
    request.method,
    // The path is already encoded once (S3 does not double-encode)
    request.url.pathname || '/',
    query,
    canonicalHeaders,
    signedHeaders,
    request.headers['x-amz-content-sha256'],
  ].join('\n')
  const scope = `${day}/${credentials.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), service), 'aws4_request')
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

export class S3Client implements RemoteDestination {
  constructor(private readonly config: S3Config) {}

  /** The full key of a file name under the prefix. */
  private key(name: string): string {
    const prefix = this.config.prefix.replace(/^\/+/, '')
    return prefix ? `${prefix.replace(/\/*$/, '/')}${name}` : name
  }

  private url(key: string, query: Record<string, string> = {}): URL {
    const endpoint = new URL(this.config.endpoint)
    // The bucket itself (listing) has no trailing slash on a path-style URL
    const encodedKey = key ? `/${key.split('/').map(encodeRfc3986).join('/')}` : ''
    const basePath = endpoint.pathname.replace(/\/+$/, '')
    const base = this.config.forcePathStyle
      ? `${endpoint.origin}${basePath}/${encodeRfc3986(this.config.bucket)}${encodedKey}`
      : `${endpoint.protocol}//${this.config.bucket}.${endpoint.host}${basePath}${encodedKey || '/'}`
    const url = new URL(base)
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value)
    }
    return url
  }

  private async send(method: string, url: URL, options: { body?: FetchBody, contentSha256?: string, headers?: Record<string, string>, timeoutMs?: number } = {}): Promise<Response> {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const headers: Record<string, string> = {
      'host': url.host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': options.contentSha256 ?? EMPTY_SHA256,
      ...options.headers,
    }
    headers.authorization = signV4({ method, url, headers }, this.config)
    // fetch sets Host itself
    const sent = { ...headers }
    delete sent.host
    const response = await fetch(url, {
      method,
      headers: sent,
      body: options.body,
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      ...(options.body ? { duplex: 'half' } : {}),
    } as FetchInit)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1]
      throw new Error(`S3 ${method} answered HTTP ${response.status}${code ? ` (${code})` : ''}`)
    }
    return response
  }

  /** Upload a local file as `name` under the prefix. */
  async upload(localPath: string, name: string): Promise<void> {
    const { size } = await stat(localPath)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(localPath)) {
      hash.update(chunk as Buffer)
    }
    await this.send('PUT', this.url(this.key(name)), {
      body: Readable.toWeb(createReadStream(localPath)) as unknown as FetchBody,
      contentSha256: hash.digest('hex'),
      headers: { 'content-length': String(size), 'content-type': 'application/gzip' },
      // A larger archive gets longer, 2 s per MB
      timeoutMs: TIMEOUT_MS + Math.ceil(size / 1024 / 1024) * 2_000,
    })
  }

  /** The files directly under the prefix. */
  async list(): Promise<RemoteFile[]> {
    const prefix = this.key('')
    const files: RemoteFile[] = []
    let token: string | undefined
    do {
      const query: Record<string, string> = { 'list-type': '2', 'prefix': prefix, 'delimiter': '/' }
      if (token) {
        query['continuation-token'] = token
      }
      const xml = await (await this.send('GET', this.url('', query))).text()
      for (const [, block] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = decodeXml(block.match(/<Key>([^<]*)<\/Key>/)?.[1] ?? '')
        const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0)
        if (key.startsWith(prefix) && key.length > prefix.length) {
          files.push({ name: key.slice(prefix.length), size })
        }
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? '') || undefined : undefined
    } while (token)
    return files
  }

  async delete(name: string): Promise<void> {
    await this.send('DELETE', this.url(this.key(name)))
  }

  /** Check the bucket can be listed with these credentials. */
  async test(): Promise<void> {
    await this.send('GET', this.url('', { 'list-type': '2', 'prefix': this.key(''), 'max-keys': '1' }))
  }
}

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&')
}
