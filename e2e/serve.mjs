/**
 * Serves one built UI (see e2e/build.mjs) from the real backend, on fresh
 * storage seeded from test/mocks (user admin / admin).
 *
 *   node e2e/serve.mjs --ui angular|react --port 18581
 *
 * Playwright starts one per project (e2e/playwright.config.ts).
 */

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name) {
  const i = process.argv.indexOf(name)
  if (i === -1) {
    throw new Error(`missing ${name}`)
  }
  return process.argv[i + 1]
}

const ui = arg('--ui')
const port = Number(arg('--port'))
const storage = mkdtempSync(join(tmpdir(), `hb-e2e-${ui}-`))
cpSync(resolve(repoRoot, 'test/mocks'), storage, { recursive: true })

const configPath = join(storage, 'config.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const platform = config.platforms.find(p => p.platform === 'config')
platform.port = port
writeFileSync(configPath, JSON.stringify(config, null, 2))

const realPlugins = resolve(repoRoot, 'e2e/.run/plugins/node_modules')

const child = spawn('npx', ['tsx', 'src/bin/standalone.ts', '-U', storage], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    UIX_BASE_PATH_OVERRIDE: resolve(repoRoot, 'e2e/.run', ui),
    // The mock plugins (plus the real custom-UI ones, once e2e/install-plugins.mjs
    // has run), so the plugin list doesn't depend on what this machine has installed
    UIX_CUSTOM_PLUGIN_PATH: existsSync(realPlugins) ? realPlugins : join(storage, 'plugins'),
    UIX_INSECURE_MODE: '',
    UIX_DEVELOPMENT: '',
  },
})

function stop() {
  child.kill('SIGTERM')
  rmSync(storage, { recursive: true, force: true })
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.on('exit', (code) => {
  rmSync(storage, { recursive: true, force: true })
  process.exit(code ?? 0)
})
