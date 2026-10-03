/**
 * The sudoers entry `hb-service install` writes for the service user, so the
 * UI can restart / shut down the host and run npm in sudo mode (`ui.sudo`).
 * Pure functions, so the line and the file edit can be tested.
 *
 * The entry is NOPASSWD only - never SETENV. SETENV lets the caller keep or
 * set any environment variable for these commands (`sudo -E`, or
 * `sudo VAR=value cmd`), and variables such as NODE_OPTIONS, npm_config_* or
 * APT_CONFIG turn "run npm / apt-get as root" into "run any code as root".
 * Callers pass what they need as command-line options instead.
 */

/**
 * The sudoers line for `user`, allowing `commands` without a password
 */
export function buildSudoersEntry(user: string, commands: readonly string[]): string {
  return `${user}    ALL=(ALL) NOPASSWD: ${[...new Set(commands)].join(', ')}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The sudoers file content with `entry` added and any entry earlier versions
 * wrote for `user` removed - recognised by the `ALL=(ALL) NOPASSWD:SETENV: `
 * they carried - or undefined when the file needs no change. Every other line
 * is left exactly as it is.
 */
export function updateSudoersContent(current: string, user: string, entry: string): string | undefined {
  const rePrevious = new RegExp(`^${escapeRegExp(user)}\\s+ALL=\\(ALL\\) NOPASSWD:SETENV: `)
  const lines = current.split('\n')
  const kept = lines.filter(line => !rePrevious.test(line))
  if (kept.length === lines.length && lines.includes(entry)) {
    return undefined
  }
  if (!kept.includes(entry)) {
    while (kept.length && kept[kept.length - 1] === '') {
      kept.pop()
    }
    kept.push(entry, '')
  }
  return kept.join('\n')
}
