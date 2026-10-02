/**
 * Records the schema-form goldens, one plugin per Angular test process.
 *
 * @ng-formworks leaks state between forms rendered in the same process (a form
 * recorded after others can report different validity and array data than the
 * same form on its own), so every plugin gets a fresh process. That is also
 * what a user sees: the settings form of one plugin, opened on its own.
 *
 * Usage (from the repo root, after `node scripts/schema-corpus/fetch.mjs`):
 *   node scripts/schema-corpus/record.mjs [--jobs 4] [--only <substring>]
 *     [--list <file of plugin names, one per line>]
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const uiDir = resolve(repoRoot, 'ui')
const manifestPath = resolve(repoRoot, 'ui-next/src/schema-form/__corpus__/manifest.json')
const spec = 'src/app/core/components/schema-form/schema-form.golden-recorder.spec.ts'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}

const jobs = Number(arg('--jobs', '4'))
const only = arg('--only', undefined)
const listFile = arg('--list', undefined)
const listed = listFile && new Set(readFileSync(listFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean))
const plugins = JSON.parse(readFileSync(manifestPath, 'utf8'))
  .map(m => m.plugin)
  .filter(p => !only || p.includes(only))
  .filter(p => !listed || listed.has(p))

function recordOne(plugin) {
  return new Promise((resolvePromise) => {
    const child = spawn('npx', ['ng', 'test', '--no-watch', '--include', spec], {
      cwd: uiDir,
      env: {
        ...process.env,
        RECORD_SCHEMA_GOLDENS: '1',
        RECORD_SCHEMA_GOLDENS_PLUGIN: plugin,
        NODE_OPTIONS: '--no-experimental-webstorage',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('close', code => resolvePromise({ code, output }))
  })
}

const failed = []
let done = 0
const started = Date.now()
const queue = [...plugins]

async function worker() {
  for (let plugin = queue.shift(); plugin; plugin = queue.shift()) {
    let result = await recordOne(plugin)
    if (result.code !== 0) {
      result = await recordOne(plugin)
    }
    done++
    const status = result.code === 0 ? 'ok' : 'FAILED'
    if (result.code !== 0) {
      failed.push(plugin)
    }
    const minutes = ((Date.now() - started) / 60000).toFixed(1)
    console.log(`[record] ${done}/${plugins.length} ${status} ${plugin} (${minutes} min)`)
    for (const line of result.output.split('\n')) {
      if (line.includes('[golden] ')) {
        console.log(`  ${line.trim()}`)
      }
    }
  }
}

await Promise.all(Array.from({ length: Math.min(jobs, plugins.length) }, worker))

console.log(`[record] ${plugins.length - failed.length}/${plugins.length} recorded`)
if (failed.length) {
  console.log(`[record] failed: ${failed.join(', ')}`)
  process.exitCode = 1
}
