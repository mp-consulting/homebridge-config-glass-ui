#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `npx @mp-consulting/homebridge-config-glass-ui [install|revert]`: switches a
 * Homebridge install to Glass UI (or back to the official interface) in one
 * step, on a plain npm install and on the Synology, Debian and Docker
 * packages. See core/glass-ui-installer.ts.
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { program } from 'commander'

import { InstallerError, installGlassUi, revertToOfficialUi } from '../core/glass-ui-installer.js'
import { npmGlobalPrefix } from '../core/npm/npm-runner.js'

const { version } = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'))

function runNpm(args: string[]): Promise<number> {
  console.log(`> npm ${args.join(' ')}`)
  return new Promise((resolvePromise) => {
    const child = spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', () => resolvePromise(127))
    child.on('close', code => resolvePromise(code ?? 1))
  })
}

const options = {
  env: process.env,
  platform: process.platform,
  npm: runNpm,
  log: (message: string) => console.log(message),
  globalPrefix: npmGlobalPrefix,
  exists: (path: string) => access(path).then(() => true, () => false),
}

async function run(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    console.error(error instanceof InstallerError ? error.message : error)
    process.exitCode = 1
  }
}

program
  .name('homebridge-config-glass-ui')
  .description('Install Homebridge Glass UI in place of the official Homebridge web interface.')
  .version(version)

program
  .command('install', { isDefault: true })
  .description(`replace the official web interface with Glass UI ${version}, or update Glass UI`)
  .action(() => run(() => installGlassUi(options, version)))

program
  .command('revert')
  .description('put the official web interface back')
  .action(() => run(() => revertToOfficialUi(options)))

program.parse(process.argv)
