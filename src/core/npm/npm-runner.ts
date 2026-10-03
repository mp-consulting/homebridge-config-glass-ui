/* global NodeJS */
import { exec, execFile, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * The environment for npm queries whose output is parsed: no log noise and no
 * update notice mixed into stdout (the caller's environment still wins).
 */
function quietNpmEnv(): NodeJS.ProcessEnv {
  return {
    npm_config_loglevel: 'silent',
    npm_update_notifier: 'false',
    ...process.env,
  }
}

/**
 * The npm binary to spawn. Linux, macOS and FreeBSD find `npm` on the PATH;
 * on Windows it is a `.cmd` shim, looked up in the usual install locations.
 * `onMissing` is called when none of those exist (plain `npm` is returned).
 */
export function npmPath(onMissing?: () => void): string {
  if (platform() === 'win32') {
    const windowsNpmPath = [
      join(process.env.APPDATA, 'npm/npm.cmd'),
      join(process.env.ProgramFiles, 'nodejs/npm.cmd'),
      join(process.env.NVM_SYMLINK || `${process.env.ProgramFiles}/nodejs`, 'npm.cmd'),
    ].filter(existsSync)

    if (windowsNpmPath.length) {
      return windowsNpmPath[0]
    }
    onMissing?.()
  }
  return 'npm'
}

/**
 * Run a read-only npm query (e.g. `npm root -g`) and return its trimmed
 * output. Async so it never blocks the event loop - npm alone can take a
 * second or more to start on a Raspberry Pi.
 */
export async function queryNpm(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const options = { env, timeout: 10000 }
  // npm is a .cmd shim on Windows, which only runs through a shell. The
  // command line is built from the caller's fixed arguments only.
  const { stdout } = platform() === 'win32'
    ? await execAsync(['npm', ...args].join(' '), options)
    : await execFileAsync('npm', args, options)
  return stdout.toString().trim()
}

let globalPrefix: string | undefined
let globalPrefixPromise: Promise<string> | undefined

/**
 * The global npm prefix (`npm -g prefix`), looked up once and then reused.
 * A failed lookup rejects and is not cached, so the next call tries again.
 */
export function npmGlobalPrefix(): Promise<string> {
  if (globalPrefix !== undefined) {
    return Promise.resolve(globalPrefix)
  }
  globalPrefixPromise ??= queryNpm(['-g', 'prefix'], quietNpmEnv())
    .then((prefix) => {
      globalPrefix = prefix
      return prefix
    })
    .finally(() => {
      globalPrefixPromise = undefined
    })
  return globalPrefixPromise
}

/**
 * Blocking form of npmGlobalPrefix() for the hb-service CLI (it shares the cache).
 * Throws when npm cannot be run.
 */
export function npmGlobalPrefixSync(): string {
  globalPrefix ??= execSync('npm -g prefix', { env: quietNpmEnv() }).toString('utf8').trim()
  return globalPrefix
}

/**
 * The global node_modules folder under an npm prefix
 */
export function npmGlobalModulesPath(prefix: string, os: NodeJS.Platform = platform()): string {
  return os === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
}

let version: string | undefined
let versionPromise: Promise<string> | undefined

/**
 * The npm version (e.g. `11.0.0`), looked up once and then reused. A failed
 * lookup rejects and is not cached.
 */
export function npmVersion(): Promise<string> {
  if (version !== undefined) {
    return Promise.resolve(version)
  }
  versionPromise ??= queryNpm(['--version'])
    .then((v) => {
      version = v
      return v
    })
    .finally(() => {
      versionPromise = undefined
    })
  return versionPromise
}

/**
 * `npm rebuild` in `cwd`, showing npm's output. Throws when it fails.
 */
export function npmRebuild(cwd: string): void {
  execSync('npm rebuild', {
    cwd,
    stdio: 'inherit',
  })
}

/**
 * npmRebuild() for a best-effort rebuild (e.g. all global plugins): a failure
 * is reported through `onFailure` instead of thrown. Returns whether it worked.
 */
export function tryNpmRebuild(cwd: string, onFailure: (error: unknown) => void): boolean {
  try {
    npmRebuild(cwd)
    return true
  } catch (e) {
    onFailure(e)
    return false
  }
}

/**
 * Forget the cached prefix and version (for tests)
 */
export function resetNpmRunnerCache(): void {
  globalPrefix = undefined
  globalPrefixPromise = undefined
  version = undefined
  versionPromise = undefined
}
