import type { InstallerOptions } from '../../src/core/glass-ui-installer.js'

import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GLASS_UI_PACKAGE, InstallerError, installGlassUi, OFFICIAL_UI_PACKAGE, resolveTarget, revertToOfficialUi } from '../../src/core/glass-ui-installer.js'

/**
 * A stand-in for npm over a real temporary prefix: packages are folders with a
 * package.json, and each owns `bin/hb-service` the way npm links it. Like npm,
 * it refuses to install over a command another package owns.
 */
function fakeNpm(prefix: string, calls: string[][], failInstallOf?: string) {
  const modules = join(prefix, 'lib', 'node_modules')
  const bin = join(prefix, 'bin', 'hb-service')
  const binTarget = (name: string) => `../lib/node_modules/${name}/dist/bin/hb-service.js`

  return async (args: string[]): Promise<number> => {
    calls.push(args)
    const [command, , ...rest] = args
    const spec = rest.find(x => !x.startsWith('--'))!
    const name = spec.lastIndexOf('@') > 0 ? spec.slice(0, spec.lastIndexOf('@')) : spec
    const version = spec.lastIndexOf('@') > 0 ? spec.slice(spec.lastIndexOf('@') + 1) : '9.9.9'

    if (command === 'uninstall') {
      await rm(join(modules, name), { recursive: true, force: true })
      if (await readlink(bin).catch(() => '') === binTarget(name)) {
        await rm(bin)
      }
      return 0
    }

    if (name === failInstallOf) {
      return 1
    }
    const owner = await readlink(bin).catch(() => null)
    if (owner && owner !== binTarget(name)) {
      // EEXIST: file already exists
      return 1
    }
    await mkdir(join(modules, name), { recursive: true })
    await writeFile(join(modules, name, 'package.json'), JSON.stringify({ name, version }))
    await mkdir(dirname(bin), { recursive: true })
    await rm(bin, { force: true })
    await symlink(binTarget(name), bin)
    return 0
  }
}

describe('glass-ui installer (e2e)', () => {
  let prefix: string
  let modules: string
  let calls: string[][]
  let messages: string[]

  const options = (overrides: Partial<InstallerOptions> = {}): InstallerOptions => ({
    env: {},
    platform: 'linux',
    npm: fakeNpm(prefix, calls),
    log: message => messages.push(message),
    globalPrefix: async () => prefix,
    exists: async () => false,
    ...overrides,
  })

  // What the Synology package's source.sh exports
  const synologyEnv = () => ({
    UIX_BASE_PATH_OVERRIDE: join(modules, OFFICIAL_UI_PACKAGE),
    npm_config_prefix: prefix,
    HOMEBRIDGE_SYNOLOGY_PACKAGE: '1',
  })

  async function installOfficialUi(version = '5.29.0') {
    await fakeNpm(prefix, [])(['install', '-g', `${OFFICIAL_UI_PACKAGE}@${version}`])
  }

  beforeEach(async () => {
    prefix = await mkdtemp(join(tmpdir(), 'glass-ui-installer-'))
    modules = join(prefix, 'lib', 'node_modules')
    await mkdir(modules, { recursive: true })
    calls = []
    messages = []
  })

  afterEach(async () => {
    await rm(prefix, { recursive: true, force: true })
  })

  describe('on a packaged install (Synology)', () => {
    it('replaces the bundled interface and links its folder to Glass UI', async () => {
      await installOfficialUi()

      await installGlassUi(options({ env: synologyEnv() }), '2.0.0-beta.1')

      expect(calls.map(x => x[0])).toEqual(['uninstall', 'install'])
      expect(calls[1]).toContain(`${GLASS_UI_PACKAGE}@2.0.0-beta.1`)
      expect(calls[1]).toContain('--allow-scripts=@homebridge/node-pty-prebuilt-multiarch')
      // The package launcher's hard-coded path now reaches Glass UI
      expect(await readlink(join(modules, OFFICIAL_UI_PACKAGE))).toBe(GLASS_UI_PACKAGE)
      expect(JSON.parse(await readFile(join(modules, OFFICIAL_UI_PACKAGE, 'package.json'), 'utf8')).name).toBe(GLASS_UI_PACKAGE)
      expect(await readlink(join(prefix, 'bin', 'hb-service'))).toContain(GLASS_UI_PACKAGE)
      expect(messages.join('\n')).toContain('Package Center')
    })

    it('updates in place when Glass UI is already linked', async () => {
      await installOfficialUi()
      await installGlassUi(options({ env: synologyEnv() }), '2.0.0-beta.0')
      calls = []

      await installGlassUi(options({ env: synologyEnv() }), '2.0.0-beta.1')

      expect(calls.map(x => x[0])).toEqual(['install'])
      expect(await readlink(join(modules, OFFICIAL_UI_PACKAGE))).toBe(GLASS_UI_PACKAGE)
    })

    it('recovers from a half-done manual switch: old UI removed, its command and folder link missing', async () => {
      await mkdir(join(prefix, 'bin'), { recursive: true })
      await symlink(`../lib/node_modules/${OFFICIAL_UI_PACKAGE}/dist/bin/hb-service.js`, join(prefix, 'bin', 'hb-service'))

      await installGlassUi(options({ env: synologyEnv() }), '2.0.0-beta.1')

      expect(await readlink(join(prefix, 'bin', 'hb-service'))).toContain(GLASS_UI_PACKAGE)
      expect(await readlink(join(modules, OFFICIAL_UI_PACKAGE))).toBe(GLASS_UI_PACKAGE)
    })

    it('puts the official interface back when Glass UI fails to install', async () => {
      await installOfficialUi('5.29.0')
      const npm = fakeNpm(prefix, calls, GLASS_UI_PACKAGE)

      await expect(installGlassUi(options({ env: synologyEnv(), npm }), '2.0.0-beta.1')).rejects.toThrow(InstallerError)

      const restored = JSON.parse(await readFile(join(modules, OFFICIAL_UI_PACKAGE, 'package.json'), 'utf8'))
      expect(restored).toEqual({ name: OFFICIAL_UI_PACKAGE, version: '5.29.0' })
      expect((await lstat(join(modules, OFFICIAL_UI_PACKAGE))).isSymbolicLink()).toBe(false)
      expect(await readlink(join(prefix, 'bin', 'hb-service'))).toContain(OFFICIAL_UI_PACKAGE)
    })

    it('reverts to the version it replaced', async () => {
      await installOfficialUi('5.29.0')
      await installGlassUi(options({ env: synologyEnv() }), '2.0.0-beta.1')
      calls = []

      await revertToOfficialUi(options({ env: synologyEnv() }))

      expect(calls).toEqual([
        ['uninstall', '-g', GLASS_UI_PACKAGE],
        ['install', '-g', '--allow-scripts=@homebridge/node-pty-prebuilt-multiarch', `${OFFICIAL_UI_PACKAGE}@5.29.0`],
      ])
      const restored = JSON.parse(await readFile(join(modules, OFFICIAL_UI_PACKAGE, 'package.json'), 'utf8'))
      expect(restored.version).toBe('5.29.0')
      expect((await lstat(join(modules, OFFICIAL_UI_PACKAGE))).isSymbolicLink()).toBe(false)
    })
  })

  describe('on a plain npm install', () => {
    it('removes the official interface first, so its hb-service does not block the install', async () => {
      await installOfficialUi()

      const target = await installGlassUi(options(), '2.0.0-beta.1')

      expect(target.legacyPath).toBeUndefined()
      expect(calls.map(x => x[0])).toEqual(['uninstall', 'install'])
      expect(await lstat(join(modules, OFFICIAL_UI_PACKAGE)).catch(() => null)).toBeNull()
      expect(await readlink(join(prefix, 'bin', 'hb-service'))).toContain(GLASS_UI_PACKAGE)
      expect(messages.join('\n')).toContain('hb-service restart')
    })

    it('just installs when there is no other interface', async () => {
      await installGlassUi(options(), '2.0.0-beta.1')

      expect(calls.map(x => x[0])).toEqual(['install'])
    })
  })

  describe('choosing where to install', () => {
    it('refuses a packaged install reached from an ordinary shell', async () => {
      const exists = async (path: string) => path === '/var/packages/homebridge/target/app/lib/node_modules'

      await expect(resolveTarget(options({ exists }))).rejects.toThrow(/hb-shell/)
      expect(calls).toEqual([])
    })

    it('names the Docker image from its environment', async () => {
      const target = await resolveTarget(options({
        env: { UIX_BASE_PATH_OVERRIDE: `/opt/homebridge/lib/node_modules/${OFFICIAL_UI_PACKAGE}`, npm_config_prefix: '/opt/homebridge', HOMEBRIDGE_CONFIG_UI: '1' },
      }))

      expect(target).toMatchObject({ prefix: '/opt/homebridge', globalModules: '/opt/homebridge/lib/node_modules', environment: 'Docker image' })
    })

    it('ignores a base path override that is not the official interface', async () => {
      const target = await resolveTarget(options({ env: { UIX_BASE_PATH_OVERRIDE: '/somewhere/else' } }))

      expect(target).toMatchObject({ prefix, environment: 'npm global install' })
      expect(target.legacyPath).toBeUndefined()
    })
  })
})
