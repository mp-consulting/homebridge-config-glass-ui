import type { ArgumentsHost, ExceptionFilter, HttpException } from '@nestjs/common'

import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { Catch, Logger, NotFoundException } from '@nestjs/common'

@Catch(NotFoundException)
export class SpaFilter implements ExceptionFilter {
  // index.html, served from memory - every client-side route that is
  // reloaded lands here. A stat per request (no read) notices a rebuilt UI:
  // `ng build` writes index.html with new hashed script names, and serving the
  // old copy would load scripts that no longer exist (a blank page). Only a
  // successful read is kept, so a missing file (e.g. the UI not built yet) is
  // retried next time.
  private indexHtml: Promise<string> | null = null
  private indexHtmlVersion = ''

  private async getIndexHtml(): Promise<string> {
    const path = resolve(process.env.UIX_BASE_PATH, 'public/index.html')
    const { mtimeMs, size } = await stat(path)
    const version = `${mtimeMs}:${size}`
    if (!this.indexHtml || this.indexHtmlVersion !== version) {
      const read = readFile(path, 'utf-8')
      this.indexHtml = read
      this.indexHtmlVersion = version
      read.catch(() => {
        if (this.indexHtml === read) {
          this.indexHtml = null
        }
      })
    }
    return this.indexHtml
  }

  async catch(_exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const req = ctx.getRequest()
    const res = ctx.getResponse()

    if (req.url.startsWith('/api/') || req.url.startsWith('/socket.io') || req.url.startsWith('/assets')) {
      return res.code(404).send('Not Found')
    }

    let file: string
    try {
      file = await this.getIndexHtml()
    } catch (e) {
      // Nest does not await filters, so this must not reject. Answer as Nest
      // did when the synchronous read threw here.
      Logger.error(`Failed to read index.html as ${e.message}`, e.stack, 'SpaFilter')
      return res.code(500).send({ statusCode: 500, message: 'Internal server error' })
    }

    res.type('text/html')
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.header('Pragma', 'no-cache')
    res.header('Expires', '0')
    res.send(file)
  }
}
