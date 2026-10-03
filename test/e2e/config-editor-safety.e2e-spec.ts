import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BadRequestException } from '@nestjs/common'
import { pathExists, remove } from 'fs-extra'
import { describe, expect, it, vi } from 'vitest'

import { isValidWallpaperName, resolveWallpaperPath, wallpaperExtension } from '../../src/core/config/wallpaper.js'
import {
  findUnsafeNodeOption,
  findUnsafeUiValues,
  isLogCommandAllowed,
  isProtectedStoragePath,
  sanitiseStartupEnv,
} from '../../src/modules/config-editor/config-safety.js'
import { HbServiceService } from '../../src/modules/platform-tools/hb-service/hb-service.service.js'

describe('config-safety', () => {
  describe('findUnsafeNodeOption', () => {
    it.each([
      '--require /tmp/x.js',
      '-r /tmp/x.js',
      '-r./x.js',
      '--require=/tmp/x.js',
      '--import=data:text/javascript,process.exit()',
      '--loader ./l.mjs',
      '--experimental-loader=./l.mjs',
      '--inspect',
      '--inspect-brk=0.0.0.0:9229',
      '--inspect_port=9229',
      '--max-old-space-size=512 --openssl-config=/tmp/evil.cnf',
      '"--require" x',
      '--env-file=.env',
    ])('refuses %s', (value) => {
      expect(findUnsafeNodeOption(value)).toBeDefined()
    })

    it.each([
      undefined,
      '',
      '--max-old-space-size=512',
      '--trace-warnings --dns-result-order=ipv4first',
      '--unhandled-rejections=warn --enable-source-maps',
    ])('allows %s', (value) => {
      expect(findUnsafeNodeOption(value)).toBeUndefined()
    })
  })

  it('sanitiseStartupEnv drops an unsafe NODE_OPTIONS and keeps the rest', () => {
    const warn = vi.fn()
    expect(sanitiseStartupEnv({ DEBUG: '*', NODE_OPTIONS: '--require /tmp/x.js' }, warn)).toEqual({ DEBUG: '*' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('--require'))
    expect(sanitiseStartupEnv({ NODE_OPTIONS: '--max-old-space-size=256' }, warn)).toEqual({ NODE_OPTIONS: '--max-old-space-size=256' })
    expect(sanitiseStartupEnv(undefined, warn)).toEqual({})
  })

  describe('log command reading protected storage files', () => {
    const storagePath = join(tmpdir(), 'hb-storage')

    it.each([
      `cat ${join(storagePath, '.uix-secrets')}`,
      `tail -n 500 -f ${join(storagePath, 'auth.json')}`,
      `sudo -n cat ${join(storagePath, 'persist', 'AccessoryInfo.json')}`,
      `tail -f /var/log/homebridge.log ${join(storagePath, 'config.json')}`,
      'cat .uix-secrets',
      `journalctl --file=${join(storagePath, 'backups', 'x.journal')}`,
      `journalctl -D${join(storagePath, 'ssl-certs')}`,
      `cat ${join(storagePath, 'logs', '..', 'AUTH.JSON')}`,
    ])('refuses %s', (command) => {
      expect(isLogCommandAllowed(command, false, storagePath)).toBe(false)
      expect(findUnsafeUiValues({ log: { method: 'custom', command } }, {}, { terminalEnabled: false, storagePath }))
        .toEqual([{ path: 'log.command', reason: expect.stringContaining('may not read the UI secrets') }])
    })

    it.each([
      'tail -n 500 -f /var/log/homebridge.log',
      `tail -f ${join(storagePath, 'homebridge.log')}`,
      'sudo -n journalctl -o cat -f -u homebridge',
      'docker logs -f homebridge',
    ])('allows %s', (command) => {
      expect(isLogCommandAllowed(command, false, storagePath)).toBe(true)
    })
  })

  it('isLogCommandAllowed: allowlist without terminal, anything with terminal', () => {
    expect(isLogCommandAllowed('tail -f /var/log/homebridge.log', false)).toBe(true)
    expect(isLogCommandAllowed('sudo -n journalctl -o cat -f -u homebridge', false)).toBe(true)
    expect(isLogCommandAllowed('docker logs -f homebridge', false)).toBe(true)
    expect(isLogCommandAllowed('bash -c id', false)).toBe(false)
    expect(isLogCommandAllowed('docker run --rm -v /:/h alpine', false)).toBe(false)
    expect(isLogCommandAllowed('tail -f x; id', false)).toBe(false)
    expect(isLogCommandAllowed('bash -c id', true)).toBe(true)
    expect(isLogCommandAllowed('', true)).toBe(false)
  })

  it('findUnsafeUiValues grandfathers unchanged values', () => {
    const old = { restart: 'my-legacy-restart.sh', log: { method: 'custom', command: 'legacy-viewer' } }
    expect(findUnsafeUiValues({ ...old }, old, { terminalEnabled: false })).toEqual([])
    expect(findUnsafeUiValues({ restart: 'other.sh', log: { command: 'other-viewer' } }, old, { terminalEnabled: false }).map(x => x.path))
      .toEqual(['restart', 'log.command'])
  })

  describe('wallpaper', () => {
    it.each(['ui-wallpaper.jpg', 'ui-wallpaper.jpeg', 'ui-wallpaper.png', 'ui-wallpaper.webp', 'ui-wallpaper.gif', 'ui-wallpaper.JPG'])('accepts %s', (value) => {
      expect(isValidWallpaperName(value)).toBe(true)
      expect(resolveWallpaperPath('/hb', value)).toBe(join('/hb', value))
    })

    it.each([
      'auth.json',
      '.uix-secrets',
      '../auth.json',
      '/etc/passwd',
      'ui-wallpaper.png/../auth.json',
      'sub/ui-wallpaper.png',
      '..\\ui-wallpaper.png',
      'ui-wallpaper.svg',
      'ui-wallpaper.html',
      'ui-wallpaper.png\n',
      42,
    ])('refuses %s', (value) => {
      expect(isValidWallpaperName(value)).toBe(false)
      expect(resolveWallpaperPath('/hb', value)).toBeUndefined()
    })

    it('takes the upload extension from an image file name only', () => {
      expect(wallpaperExtension('photo.PNG')).toBe('.PNG')
      expect(wallpaperExtension('photo.jpeg')).toBe('.jpeg')
      expect(wallpaperExtension('evil.html')).toBeUndefined()
      expect(wallpaperExtension('evil.png.js')).toBeUndefined()
      expect(wallpaperExtension('noext')).toBeUndefined()
      expect(wallpaperExtension(undefined)).toBeUndefined()
    })

    it('findUnsafeUiValues refuses a new wallpaper value that is not an uploaded wallpaper', () => {
      expect(findUnsafeUiValues({ wallpaper: '../auth.json' }, {}, { terminalEnabled: true }).map(x => x.path)).toEqual(['wallpaper'])
      expect(findUnsafeUiValues({ wallpaper: '/etc/shadow' }, {}, { terminalEnabled: true }).map(x => x.path)).toEqual(['wallpaper'])
      expect(findUnsafeUiValues({ wallpaper: 'ui-wallpaper.png' }, {}, { terminalEnabled: false })).toEqual([])
      expect(findUnsafeUiValues({ wallpaper: '' }, {}, { terminalEnabled: false })).toEqual([])
      // grandfathered when unchanged
      expect(findUnsafeUiValues({ wallpaper: '/legacy/wall.jpg' }, { wallpaper: '/legacy/wall.jpg' }, { terminalEnabled: false })).toEqual([])
    })
  })

  describe('log path', () => {
    const storagePath = join(tmpdir(), 'hb-storage')

    it.each([
      join(storagePath, 'auth.json'),
      join(storagePath, '.uix-secrets'),
      join(storagePath, 'persist', 'AccessoryInfo.0EAABBCCDDEE.json'),
      join(storagePath, 'ssl-certs', 'key.pem'),
      join(storagePath, 'config.json'),
      join(storagePath, 'matter', 'x', 'keys.json'),
      join(storagePath, 'backups', 'config-backups', 'config.json.1'),
      join(storagePath, 'logs', '..', 'auth.json'),
      join(storagePath.toUpperCase(), 'AUTH.JSON'),
      'auth.json',
      './persist/x.json',
    ])('refuses %s', (path) => {
      expect(isProtectedStoragePath(path, storagePath)).toBe(true)
      expect(findUnsafeUiValues({ log: { method: 'file', path } }, {}, { terminalEnabled: true, storagePath }).map(x => x.path)).toEqual(['log.path'])
    })

    it.each([
      join(storagePath, 'homebridge.log'),
      join(storagePath, 'logs', 'homebridge.log'),
      join(storagePath, 'auth.json.log'),
      '/var/log/homebridge.log',
      join(tmpdir(), 'auth.json'),
    ])('allows %s', (path) => {
      expect(isProtectedStoragePath(path, storagePath)).toBe(false)
      expect(findUnsafeUiValues({ log: { method: 'file', path } }, {}, { terminalEnabled: true, storagePath })).toEqual([])
    })

    it('grandfathers an unchanged value at save time', () => {
      const path = join(storagePath, 'auth.json')
      expect(findUnsafeUiValues({ log: { method: 'file', path } }, { log: { method: 'file', path } }, { terminalEnabled: true, storagePath })).toEqual([])
    })
  })

  describe('hb-service startup settings save', () => {
    const make = async () => {
      const storagePath = await mkdtemp(join(tmpdir(), 'hb-service-settings-'))
      const configService = { storagePath, hbServiceUiRestartRequired: false } as any
      const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() } as any
      return { storagePath, service: new HbServiceService(configService, logger), logger }
    }

    it('refuses a NODE_OPTIONS that loads code', async () => {
      const { storagePath, service, logger } = await make()
      try {
        await expect(service.setHomebridgeStartupSettings({
          HOMEBRIDGE_DEBUG: false,
          HOMEBRIDGE_KEEP_ORPHANS: false,
          HOMEBRIDGE_INSECURE: true,
          ENV_NODE_OPTIONS: '--import=/tmp/evil.mjs',
        })).rejects.toBeInstanceOf(BadRequestException)
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('--import'))
        expect(await pathExists(join(storagePath, '.uix-hb-service-homebridge-startup.json'))).toBe(false)
      } finally {
        await remove(storagePath)
      }
    })

    it('saves a harmless NODE_OPTIONS', async () => {
      const { storagePath, service } = await make()
      try {
        await service.setHomebridgeStartupSettings({
          HOMEBRIDGE_DEBUG: false,
          HOMEBRIDGE_KEEP_ORPHANS: false,
          HOMEBRIDGE_INSECURE: true,
          ENV_NODE_OPTIONS: '--max-old-space-size=512',
        })
        expect(await pathExists(join(storagePath, '.uix-hb-service-homebridge-startup.json'))).toBe(true)
      } finally {
        await remove(storagePath)
      }
    })
  })
})
