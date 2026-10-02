/**
 * Validation for config values that end up executed as a command, shared by
 * every place they are saved (config editor, settings PATCH, backup restore,
 * hb-service startup settings) and every place they are used (restart, log
 * viewer, hb-service). Pure functions only, so `src/bin` can import it too.
 */

import { RE_SAFE_RESTART_CMD } from '../../core/regex.constants.js'

/**
 * Allowlist for a custom log command (`ui.log.method: 'custom'`) when the
 * terminal is disabled: an optional `sudo -n`, then `tail`, `journalctl`,
 * `cat`, or `docker|podman logs`, then plain arguments. The command is split
 * on spaces and spawned without a shell, so the binary is what matters -
 * this keeps an admin from running `bash -c ...` as the "log command".
 */
export const RE_SAFE_LOG_CMD = /^(?:sudo(?:\s+-n)?\s+)?(?:tail|journalctl|cat|(?:docker|podman)\s+logs)(?:\s+[\w./:=@,+-]+)*\s*$/

/**
 * NODE_OPTIONS flags that load code, open a debugger, or read/write files of
 * the caller's choosing. Matched after normalising `_` to `-` (node accepts
 * both) and dropping any `=value`.
 */
const UNSAFE_NODE_OPTIONS = [
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '--experimental-policy',
  '--policy-integrity',
  '--openssl-config',
  '--env-file',
  '--env-file-if-exists',
  '--redirect-warnings',
  '--report-directory',
  '--diagnostic-dir',
  '--heapsnapshot-signal',
  '--icu-data-dir',
]

// Any `--inspect*` / `--debug*` variant opens a debugger that can run code
const RE_UNSAFE_NODE_OPTION_PREFIX = /^--(?:inspect|debug)/

// eslint-disable-next-line no-control-regex
const RE_CONTROL_CHARS = /[\u0000-\u001F\u007F]/

export const RESTART_COMMAND_RULE = 'The command must use systemctl, service, shutdown, reboot, poweroff, halt, or init, optionally prefixed with sudo, and may not contain shell metacharacters.'
export const NODE_OPTIONS_RULE = 'NODE_OPTIONS may not use --require, --import, --loader, --inspect or other flags that load code, open a debugger or read/write files.'
export const LOG_COMMAND_RULE = 'With terminal access disabled, a custom log command must be tail, journalctl, cat, docker logs or podman logs (optionally prefixed with "sudo -n") with plain arguments.'

/**
 * Returns the first NODE_OPTIONS flag that is not allowed, or undefined.
 */
export function findUnsafeNodeOption(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'string') {
    return String(value)
  }
  for (const raw of value.split(/\s+/)) {
    const token = raw.replace(/["'\\]/g, '')
    if (!token.startsWith('-')) {
      continue
    }
    const name = token.split('=')[0].replace(/_/g, '-')
    if (
      UNSAFE_NODE_OPTIONS.includes(name)
      || RE_UNSAFE_NODE_OPTION_PREFIX.test(name)
      // Short `-r` written together with its value (`-r./x.js`)
      || (name.startsWith('-r') && !name.startsWith('--'))
    ) {
      return name
    }
  }
  return undefined
}

/**
 * Copy of the hb-service startup `env` with an unsafe NODE_OPTIONS dropped.
 */
export function sanitiseStartupEnv(env: unknown, warn: (msg: string) => void): Record<string, unknown> {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return {}
  }
  const result = { ...env as Record<string, unknown> }
  const unsafe = findUnsafeNodeOption(result.NODE_OPTIONS)
  if (unsafe) {
    warn(`Ignoring NODE_OPTIONS from the startup settings: "${unsafe}" is not allowed. ${NODE_OPTIONS_RULE}`)
    delete result.NODE_OPTIONS
  }
  return result
}

/**
 * Whether a custom log command may run. With terminal access enabled an
 * admin already has a shell, so any command is allowed; otherwise it must
 * match `RE_SAFE_LOG_CMD`.
 */
export function isLogCommandAllowed(command: unknown, terminalEnabled: boolean): boolean {
  if (typeof command !== 'string' || !command.trim()) {
    return false
  }
  return terminalEnabled || RE_SAFE_LOG_CMD.test(command)
}

export function isSafeRestartCommand(command: unknown): boolean {
  return typeof command === 'string' && RE_SAFE_RESTART_CMD.test(command)
}

export interface UnsafeUiValue {
  /** Dotted path inside the UI platform block, e.g. `log.command` */
  path: string
  reason: string
}

/**
 * Check the command-like values of a UI platform block. A value equal to the
 * one in `oldUi` (the running config) is grandfathered, so a legacy value
 * does not block unrelated saves - it is still checked again when it is used.
 */
export function findUnsafeUiValues(newUi: any, oldUi: any, opts: { terminalEnabled: boolean }): UnsafeUiValue[] {
  if (!newUi || typeof newUi !== 'object') {
    return []
  }
  const unsafe: UnsafeUiValue[] = []
  const isEmpty = (v: unknown) => v === undefined || v === null || v === ''

  for (const path of ['restart', 'linux.restart', 'linux.shutdown']) {
    const [a, b] = path.split('.')
    const newValue = b ? newUi[a]?.[b] : newUi[a]
    const oldValue = b ? oldUi?.[a]?.[b] : oldUi?.[a]
    if (newValue === oldValue || isEmpty(newValue)) {
      continue
    }
    if (!isSafeRestartCommand(newValue)) {
      unsafe.push({ path, reason: `Unsafe restart/shutdown command. ${RESTART_COMMAND_RULE}` })
    }
  }

  const newLog = newUi.log && typeof newUi.log === 'object' ? newUi.log : undefined
  const oldLog = oldUi?.log && typeof oldUi.log === 'object' ? oldUi.log : undefined
  if (newLog) {
    if (newLog.command !== oldLog?.command && !isEmpty(newLog.command) && !isLogCommandAllowed(newLog.command, opts.terminalEnabled)) {
      unsafe.push({ path: 'log.command', reason: `Unsafe log command. ${LOG_COMMAND_RULE}` })
    }
    if (newLog.path !== oldLog?.path && !isEmpty(newLog.path) && (typeof newLog.path !== 'string' || RE_CONTROL_CHARS.test(newLog.path))) {
      unsafe.push({ path: 'log.path', reason: 'The log path must be a plain file path without control characters.' })
    }
  }

  return unsafe
}

/**
 * Remove the values reported by `findUnsafeUiValues` from a UI block in place.
 */
export function removeUnsafeUiValues(ui: any, unsafe: UnsafeUiValue[]): void {
  for (const { path } of unsafe) {
    const [a, b] = path.split('.')
    if (b) {
      if (ui[a] && typeof ui[a] === 'object') {
        delete ui[a][b]
      }
    } else {
      delete ui[a]
    }
  }
}
