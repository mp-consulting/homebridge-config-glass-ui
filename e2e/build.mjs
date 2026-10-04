/**
 * Builds the UI the e2e suite runs against into e2e/.run/ui/public:
 *
 *   node e2e/build.mjs
 *
 * The build gets a base dir of its own (UIX_BASE_PATH_OVERRIDE for
 * e2e/serve.mjs): the backend reads `public/` and `package.json` from it, so
 * the suite never touches the repo's own `public/`.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseDir = resolve(repoRoot, 'e2e/.run/ui')
const publicDir = resolve(baseDir, 'public')

rmSync(baseDir, { recursive: true, force: true })
mkdirSync(baseDir, { recursive: true })
// A fixed version: the dashboard and settings print it, and the visual
// baselines (e2e/specs/visual.spec.ts) should not change on every release
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
writeFileSync(resolve(baseDir, 'package.json'), `${JSON.stringify({ ...pkg, version: '2.0.0' }, null, 2)}\n`)

console.warn(`[e2e] building the UI → ${publicDir}`)
execFileSync('npm', ['run', 'build', '--', '--outDir', publicDir], { cwd: resolve(repoRoot, 'ui'), stdio: 'inherit' })
