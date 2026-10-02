#!/usr/bin/env node
/**
 * Builds the schema-form golden corpus inputs (see
 * ui-next/src/schema-form/__corpus__/README.md).
 *
 *   node scripts/schema-corpus/fetch.mjs                  # pick the top plugins, write manifest + schemas
 *   node scripts/schema-corpus/fetch.mjs --from-manifest  # re-download exactly the pinned versions
 *   node scripts/schema-corpus/fetch.mjs --count 150      # change the target size (default 200)
 *
 * Plugins come from the npm search API (keyword `homebridge-plugin`), ordered
 * by monthly downloads. For each one the latest tarball is streamed and only
 * `<root>/config.schema.json` is kept. Plugins without one, with invalid JSON,
 * or with `customUi: true` and no `schema` key are skipped.
 */
import { Buffer } from 'node:buffer'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import { Parser } from 'tar'

const REGISTRY = 'https://registry.npmjs.org'
const SEARCH_PAGE_SIZE = 250
const SEARCH_MAX_CANDIDATES = 1000
const CONCURRENCY = 6
const SCHEMA_ENTRY = /^[^/]+\/config\.schema\.json$/

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const corpusDir = join(repoRoot, 'ui-next/src/schema-form/__corpus__')
const schemasDir = join(corpusDir, 'schemas')
const manifestPath = join(corpusDir, 'manifest.json')

const args = process.argv.slice(2)
const fromManifest = args.includes('--from-manifest')
const countArg = args.indexOf('--count')
const targetCount = countArg === -1 ? 200 : Number(args[countArg + 1])

/** `@scope/name` -> `@scope__name` */
function schemaFileName(plugin) {
  return `${plugin.replace(/\//g, '__')}.json`
}

async function fetchJson(url, attempt = 1) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 4) {
      await new Promise(r => setTimeout(r, 1000 * attempt))
      return fetchJson(url, attempt + 1)
    }
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`)
  }
  return res.json()
}

function packageUrl(name, suffix) {
  return `${REGISTRY}/${name.replace('/', '%2F')}/${suffix}`
}

/** Streams the tarball and returns the text of config.schema.json, or null */
async function extractSchema(tarballUrl) {
  const res = await fetch(tarballUrl)
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} for ${tarballUrl}`)
  }

  let text = null
  const parser = new Parser({
    filter: path => SCHEMA_ENTRY.test(path),
    onReadEntry: (entry) => {
      const chunks = []
      entry.on('data', chunk => chunks.push(chunk))
      entry.on('end', () => {
        // Keep the first match only (tarballs normally have one root, `package/`)
        if (text === null) {
          text = Buffer.concat(chunks).toString('utf8')
        }
      })
    },
  })

  await pipeline(Readable.fromWeb(res.body), parser)
  return text
}

/** Returns { schema } or { skip: reason } */
async function loadSchema(name, version) {
  const meta = await fetchJson(packageUrl(name, version))
  const text = await extractSchema(meta.dist.tarball)
  if (text === null) {
    return { version: meta.version, skip: 'no config.schema.json' }
  }

  let schema
  try {
    schema = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    return { version: meta.version, skip: `invalid JSON (${error.message})` }
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { version: meta.version, skip: 'schema is not an object' }
  }
  if (schema.customUi === true && !('schema' in schema)) {
    return { version: meta.version, skip: 'customUi without schema' }
  }
  return { version: meta.version, text }
}

async function searchCandidates() {
  const seen = new Map()
  for (let from = 0; from < SEARCH_MAX_CANDIDATES; from += SEARCH_PAGE_SIZE) {
    const url = `${REGISTRY}/-/v1/search?text=keywords:homebridge-plugin&size=${SEARCH_PAGE_SIZE}&from=${from}&popularity=1.0`
    const page = await fetchJson(url)
    for (const obj of page.objects) {
      const name = obj.package.name
      if (!seen.has(name)) {
        seen.set(name, obj.downloads?.monthly ?? 0)
      }
    }
    if (page.objects.length < SEARCH_PAGE_SIZE) {
      break
    }
  }

  // The UI itself is not a plugin with a settings form worth testing
  seen.delete('homebridge-config-ui-x')

  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
}

/**
 * Runs `worker` over `items` with a fixed concurrency, in order, stopping new
 * work once `done()` is true. Results are returned in input order.
 */
async function runPool(items, worker, done = () => false) {
  const results = Array.from({ length: items.length })
  let next = 0
  async function lane() {
    while (next < items.length && !done()) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, lane))
  return results
}

async function main() {
  await mkdir(schemasDir, { recursive: true })

  let accepted = []
  const skipped = []

  if (fromManifest) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const results = await runPool(manifest, async ({ plugin, version }) => {
      try {
        return { plugin, ...(await loadSchema(plugin, version)) }
      } catch (error) {
        return { plugin, version, skip: error.message }
      }
    })
    for (const r of results) {
      if (r.skip) {
        skipped.push(r)
      } else {
        accepted.push(r)
      }
    }
  } else {
    const candidates = await searchCandidates()
    console.log(`${candidates.length} candidates from npm search`)

    // Fetch in popularity order; with concurrency a few extra may finish past
    // the target, so trim to the most popular `targetCount` afterwards
    let acceptedCount = 0
    const results = await runPool(candidates, async (plugin) => {
      try {
        const r = { plugin, ...(await loadSchema(plugin, 'latest')) }
        if (!r.skip) {
          acceptedCount++
        }
        return r
      } catch (error) {
        return { plugin, skip: error.message }
      }
    }, () => acceptedCount >= targetCount)

    for (const r of results) {
      if (!r) {
        continue
      }
      if (r.skip) {
        skipped.push(r)
      } else {
        accepted.push(r)
      }
    }
    accepted = accepted.slice(0, targetCount)

    // Fresh selection: drop schema files left over from an older manifest
    for (const file of await readdir(schemasDir)) {
      if (file.endsWith('.json')) {
        await rm(join(schemasDir, file))
      }
    }
  }

  for (const { plugin, text } of accepted) {
    await writeFile(join(schemasDir, schemaFileName(plugin)), text)
  }

  if (!fromManifest) {
    const manifest = accepted
      .map(({ plugin, version }) => ({ plugin, version }))
      .sort((a, b) => a.plugin.localeCompare(b.plugin))
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  const reasons = {}
  for (const s of skipped) {
    const key = s.skip.replace(/\(.*\)/, '').replace(/https?:\/\/\S+/, '<url>').trim()
    reasons[key] = (reasons[key] ?? 0) + 1
  }
  console.log(`wrote ${accepted.length} schemas, skipped ${skipped.length}`)
  for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}  ${reason}`)
  }
  if (fromManifest && skipped.length) {
    for (const s of skipped) {
      console.error(`  ${s.plugin}@${s.version}: ${s.skip}`)
    }
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
