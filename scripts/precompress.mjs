/**
 * Writes Brotli (`.br`) and gzip (`.gz`) copies next to every compressible
 * file in the UI build output, so @fastify/static (`preCompressed: true` in
 * `src/main.ts`) can serve them with `Content-Encoding` instead of the raw
 * bytes. Compressing at build time costs nothing per request, and lets us use
 * the maximum Brotli quality, which would be far too slow on the fly.
 *
 * Fonts (woff2 is already Brotli inside), images and source maps are skipped,
 * as are files too small for compression to pay for its headers.
 *
 *   node scripts/precompress.mjs [public dir]
 *
 * Runs automatically via the `postbuild:ui` script.
 */

import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(repoRoot, process.argv[2] ?? 'public')

const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt'])
const MIN_BYTES = 1024
const VARIANTS = ['.br', '.gz']

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(path)
    } else if (entry.isFile()) {
      yield path
    }
  }
}

let count = 0
let raw = 0
let brTotal = 0

async function processFile(path) {
  const variant = VARIANTS.find(ext => path.endsWith(ext))
  if (variant) {
    // A variant whose source is gone would be served for a file that no longer exists
    const source = path.slice(0, -variant.length)
    if (!await stat(source).catch(() => null)) {
      await rm(path)
    }
    return
  }
  if (!COMPRESSIBLE.has(extname(path).toLowerCase())) {
    return
  }
  const data = await readFile(path)
  if (data.length < MIN_BYTES) {
    return
  }
  const [br, gzipped] = await Promise.all([
    brotli(data, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
      },
    }),
    gz(data, { level: constants.Z_BEST_COMPRESSION }),
  ])
  await Promise.all([writeFile(`${path}.br`, br), writeFile(`${path}.gz`, gzipped)])
  count += 1
  raw += data.length
  brTotal += br.length
}

// zlib's async calls run on the libuv threadpool, so a few files in flight at
// once keeps every pool thread busy instead of compressing one file at a time
const queue = []
for await (const path of walk(publicDir)) {
  queue.push(path)
}
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    await processFile(queue.pop())
  }
}))

console.warn(`[precompress] ${count} files, ${(raw / 1024).toFixed(0)} kB -> ${(brTotal / 1024).toFixed(0)} kB brotli`)
