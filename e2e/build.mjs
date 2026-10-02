/**
 * Builds the UIs the parity suite runs against into e2e/.run/<ui>/public.
 *
 *   node e2e/build.mjs [angular] [react]     (both when none is given)
 *
 * Each build gets a base dir of its own (UIX_BASE_PATH for e2e/serve.mjs):
 * the backend reads `public/` and `package.json` from it.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runDir = resolve(repoRoot, 'e2e/.run')
const uis = process.argv.slice(2).length ? process.argv.slice(2) : ['angular', 'react']

for (const ui of uis) {
  const baseDir = resolve(runDir, ui)
  const publicDir = resolve(baseDir, 'public')
  rmSync(baseDir, { recursive: true, force: true })
  mkdirSync(baseDir, { recursive: true })
  copyFileSync(resolve(repoRoot, 'package.json'), resolve(baseDir, 'package.json'))

  console.warn(`[e2e] building ${ui} → ${publicDir}`)
  if (ui === 'angular') {
    execFileSync('npx', ['ng', 'build', '--configuration', 'production', '--output-path', publicDir], { cwd: resolve(repoRoot, 'ui'), stdio: 'inherit' })
    // A string --output-path puts the browser files in a `browser/` subfolder
    const browserDir = resolve(publicDir, 'browser')
    if (existsSync(resolve(browserDir, 'index.html'))) {
      const tmp = `${publicDir}.tmp`
      renameSync(browserDir, tmp)
      rmSync(publicDir, { recursive: true, force: true })
      renameSync(tmp, publicDir)
    }
  } else if (ui === 'react') {
    execFileSync('npm', ['run', 'build', '--', '--outDir', publicDir], { cwd: resolve(repoRoot, 'ui-next'), stdio: 'inherit' })
  } else {
    throw new Error(`unknown ui "${ui}" (angular | react)`)
  }
}
