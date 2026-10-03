import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { buildSudoersEntry, updateSudoersContent } from '../../src/bin/platforms/sudoers.js'
import { npmSettingsAsOptions, PluginInstallerService } from '../../src/modules/plugins/plugin-installer.service.js'

describe('sudoers entry', () => {
  const commands = ['/usr/sbin/shutdown', '/usr/bin/npm', '/usr/bin/npm', '/usr/local/bin/npm', '/usr/bin/apt-get update']

  it('grants NOPASSWD without SETENV, listing each command once', () => {
    const entry = buildSudoersEntry('homebridge', commands)
    expect(entry).toBe('homebridge    ALL=(ALL) NOPASSWD: /usr/sbin/shutdown, /usr/bin/npm, /usr/local/bin/npm, /usr/bin/apt-get update')
    expect(entry).not.toContain('SETENV')
  })

  it('appends the entry when the file has none', () => {
    const entry = buildSudoersEntry('homebridge', commands)
    expect(updateSudoersContent('root ALL=(ALL) ALL\n\n', 'homebridge', entry)).toBe(`root ALL=(ALL) ALL\n${entry}\n`)
  })

  it('leaves the file alone when the entry is already there', () => {
    const entry = buildSudoersEntry('homebridge', commands)
    expect(updateSudoersContent(`root ALL=(ALL) ALL\n${entry}\n`, 'homebridge', entry)).toBeUndefined()
  })

  it('replaces an entry an earlier version wrote with SETENV, and nothing else', () => {
    const entry = buildSudoersEntry('homebridge', commands)
    const old = 'homebridge    ALL=(ALL) NOPASSWD:SETENV: /usr/sbin/shutdown, /usr/bin/npm, /usr/bin/apt-get update'
    const other = 'otheruser    ALL=(ALL) NOPASSWD:SETENV: /usr/bin/npm'
    const current = `root ALL=(ALL) ALL\n${old}\n${other}\nhomebridge ALL=(ALL) NOPASSWD: /usr/bin/true\n`

    const updated = updateSudoersContent(current, 'homebridge', entry)!
    expect(updated).toBe(`root ALL=(ALL) ALL\n${other}\nhomebridge ALL=(ALL) NOPASSWD: /usr/bin/true\n${entry}\n`)
    expect(updated.split('\n').filter(line => line.startsWith('homebridge') && line.includes('SETENV'))).toEqual([])

    // An old SETENV line next to an up-to-date entry is still removed
    expect(updateSudoersContent(`${old}\n${entry}\n`, 'homebridge', entry)).toBe(`${entry}\n`)
  })

  it('does not treat the username as a pattern', () => {
    const entry = buildSudoersEntry('h.b', ['/usr/bin/npm'])
    const unrelated = 'hxb    ALL=(ALL) NOPASSWD:SETENV: /usr/bin/npm'
    expect(updateSudoersContent(`${unrelated}\n`, 'h.b', entry)).toBe(`${unrelated}\n${entry}\n`)
  })
})

describe('npm settings under sudo', () => {
  /** Run runNpmCommand against fakes, returning what it spawned */
  async function spawnedFor(sudo: boolean) {
    const spawn = vi.fn((_file: string, _args: string[], _opts: any) => ({
      onData: () => {},
      onExit: (cb: (e: { exitCode: number }) => void) => setImmediate(() => cb({ exitCode: 0 })),
      kill: () => {},
    }))
    const service = Object.assign(Object.create(PluginInstallerService.prototype), {
      configService: { ui: { sudo }, minimumNodeVersion: '0.0.0' },
      nodePtyService: { spawn },
      logger: { log: () => {}, error: () => {}, warn: () => {} },
      installed: { getNpmGlobalRoot: async () => undefined, pluginManagementStarted: () => {}, pluginManagementFinished: () => {} },
    }) as PluginInstallerService
    await service.runNpmCommand(['npm', 'install', '-g', 'homebridge-dummy@1.0.0'], '/usr/local/lib', new EventEmitter())
    const [file, args, opts] = spawn.mock.calls[0]
    return { file, args, env: opts.env }
  }

  it('runs plain `sudo -n` (no -E, which needs SETENV) and passes npm\'s settings as options', async () => {
    const { file, args } = await spawnedFor(true)
    expect(file).toBe('sudo')
    expect(args).not.toContain('-E')
    expect(args.slice(0, 5)).toEqual(['-n', 'npm', 'install', '-g', 'homebridge-dummy@1.0.0'])
    expect(args).toEqual(expect.arrayContaining(['--global-style=true', '--foreground-scripts=true', '--loglevel=error', '--prefix=/usr/local']))
  })

  it('keeps using the environment without sudo', async () => {
    const { file, args, env } = await spawnedFor(false)
    expect(file).toBe('npm')
    expect(args).toEqual(['install', '-g', 'homebridge-dummy@1.0.0'])
    expect(env).toMatchObject({ npm_config_global_style: 'true', npm_config_prefix: '/usr/local' })
  })

  it('turns npm_config_* settings into the equivalent command-line options', () => {
    expect(npmSettingsAsOptions({
      npm_config_global_style: 'true',
      npm_config_prefer_online: 'true',
      npm_config_loglevel: 'error',
      npm_config_prefix: '/usr/local',
      NODE_OPTIONS: '--require /tmp/x.js',
    })).toEqual([
      '--global-style=true',
      '--prefer-online=true',
      '--loglevel=error',
      '--prefix=/usr/local',
    ])
  })
})
