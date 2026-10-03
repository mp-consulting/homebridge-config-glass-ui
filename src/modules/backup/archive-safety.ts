import type { MultipartFile } from '@fastify/multipart'
import type { Stats } from 'node:fs'
import type { Readable } from 'node:stream'
import type { ReadEntry } from 'tar'

import { createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline, Transform } from 'node:stream'
import { promisify } from 'node:util'

import { BadRequestException } from '@nestjs/common'
import { extract } from 'tar'
import { Parse } from 'unzipper'

const pump = promisify(pipeline)

/**
 * Most a restore may expand to, as a multiple of the upload limit. Only the
 * compressed upload is size-limited, and a small gzip or zip bomb can
 * otherwise fill the disk holding the temp directory.
 */
const MAX_EXTRACT_RATIO = 20

/** The extraction budget, in bytes */
function maxExtractBytes(): number {
  return globalThis.backup.maxBackupSize * MAX_EXTRACT_RATIO
}

function overBudgetError(maxBytes: number): BadRequestException {
  return new BadRequestException(`Backup expands to more than ${(maxBytes / (1024 * 1024)).toFixed(0)}MB and cannot be restored.`)
}

/**
 * An upload cut off at the size limit reaches the extractor as a short but
 * otherwise normal stream, so the partial archive must not be restored.
 */
export function assertUploadComplete(data: MultipartFile): void {
  if (data.file.truncated) {
    throw new BadRequestException(`Backup file exceeds maximum restore file size (${globalThis.backup.maxBackupSizeText}).`)
  }
}

/**
 * Tar `extract` filter that skips absolute paths, `..` segments, symlink
 * and hardlink entries, and device/FIFO entries. Pairs with
 * `strict: true, preservePaths: false` to keep crafted backups from
 * writing outside the temp restore dir or diverting a later `copy`
 * through a link onto the host.
 */
export function tarSafeFilter(path: string, entry: ReadEntry | Stats): boolean {
  const type = (entry as ReadEntry).type
  if (
    type === 'SymbolicLink'
    || type === 'Link'
    || type === 'CharacterDevice'
    || type === 'BlockDevice'
    || type === 'FIFO'
  ) {
    return false
  }
  if (path.startsWith('/') || path.startsWith('..') || path.includes(`..${sep}`) || path.includes('../')) {
    return false
  }
  return true
}

/**
 * `tarSafeFilter` plus a budget on the total size extracted. tar enforces
 * each entry's declared size, so summing it is exact. Entries past the
 * budget are skipped, and `assertWithinBudget` fails the restore after.
 */
export function createTarRestoreFilter() {
  const maxBytes = maxExtractBytes()
  let extractedBytes = 0
  return {
    filter: (path: string, entry: ReadEntry | Stats): boolean => {
      if (!tarSafeFilter(path, entry)) {
        return false
      }
      extractedBytes += entry.size || 0
      return extractedBytes <= maxBytes
    },
    assertWithinBudget: () => {
      if (extractedBytes > maxBytes) {
        throw overBudgetError(maxBytes)
      }
    },
  }
}

/**
 * Extract a .tar.gz stream into `destDir` through `createTarRestoreFilter`,
 * failing when it expands past the budget.
 */
export async function extractTarSafely(source: Readable, destDir: string): Promise<void> {
  const { filter, assertWithinBudget } = createTarRestoreFilter()
  await pump(source, extract({
    cwd: destDir,
    strict: true,
    preservePaths: false,
    filter,
  }))
  assertWithinBudget()
}

/**
 * Stream-based zip extractor with per-entry path validation. Rejects any
 * entry whose resolved path escapes the destination directory (Zip Slip,
 * CVE-2024-22363 / CVE-2024-43374), and stops once the bytes actually
 * written exceed the extraction budget - a zip's declared sizes can lie.
 */
export async function extractZipSafely(source: Readable, destDir: string): Promise<void> {
  const normalisedDest = resolve(destDir)
  const maxBytes = maxExtractBytes()
  let extractedBytes = 0
  const countBytes = () => new Transform({
    transform(chunk, _encoding, callback) {
      extractedBytes += chunk.length
      callback(extractedBytes > maxBytes ? overBudgetError(maxBytes) : null, chunk)
    },
  })
  return new Promise<void>((res, rej) => {
    let pending = 1
    let aborted = false
    let firstError: Error | undefined

    const done = (err?: Error) => {
      if (err && !firstError) {
        firstError = err
        aborted = true
      }
      pending--
      if (pending === 0) {
        firstError ? rej(firstError) : res()
      }
    }

    // pipe() does not forward the source's errors (an aborted upload)
    source.on('error', done)
    source.pipe(Parse())
      .on('entry', (entry: any) => {
        if (aborted) {
          entry.autodrain()
          return
        }
        const entryPath = resolve(normalisedDest, entry.path)
        const rel = relative(normalisedDest, entryPath)
        if (rel.startsWith('..') || isAbsolute(rel)) {
          entry.autodrain()
          done(new Error(`Zip entry escapes destination: ${entry.path}`))
          return
        }
        if (entry.type === 'Directory') {
          pending++
          mkdir(entryPath, { recursive: true })
            .then(() => done())
            .catch(done)
          entry.autodrain()
          return
        }
        pending++
        mkdir(dirname(entryPath), { recursive: true })
          .then(() => pump(entry, countBytes(), createWriteStream(entryPath)))
          .then(() => done())
          .catch(done)
      })
      .on('error', done)
      .on('close', () => done())
  })
}

/**
 * Defence-in-depth — walk an extracted archive and refuse to proceed if any
 * entry is a symbolic link. `tarSafeFilter` and `extractZipSafely` already
 * block symlink entries; this catches anything that slipped through.
 */
export async function assertNoSymlinks(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(dir, entry.name)
    const stats = await lstat(entryPath)
    if (stats.isSymbolicLink()) {
      throw new Error(`Archive contains symlink at ${entryPath} — refusing to restore.`)
    }
    if (entry.isDirectory()) {
      await assertNoSymlinks(entryPath)
    }
  }
}
