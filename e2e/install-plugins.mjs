/**
 * Installs real plugins with a custom settings UI (plugin-ui-utils) next to
 * the mock plugins, for e2e/specs/custom-ui.spec.ts:
 *
 *   node e2e/install-plugins.mjs
 *
 * e2e/serve.mjs uses e2e/.run/plugins/node_modules as the plugin path when it
 * exists. Install scripts are not run: the settings UIs don't need them.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CUSTOM_UI_PLUGINS = {
  'homebridge-ring': '14.3.0',
  '@homebridge-plugins/homebridge-camera-ffmpeg': '4.1.0',
  'homebridge-unifi-protect': '8.1.0',
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prefix = resolve(repoRoot, 'e2e/.run/plugins')

mkdirSync(prefix, { recursive: true })
writeFileSync(resolve(prefix, 'package.json'), `${JSON.stringify({ private: true }, null, 2)}\n`)
execFileSync('npm', [
  'install',
  '--no-save',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  ...Object.entries(CUSTOM_UI_PLUGINS).map(([name, version]) => `${name}@${version}`),
], { cwd: prefix, stdio: 'inherit' })
cpSync(resolve(repoRoot, 'test/mocks/plugins'), resolve(prefix, 'node_modules'), { recursive: true })
