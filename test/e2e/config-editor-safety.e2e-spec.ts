import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BadRequestException } from '@nestjs/common'
import { pathExists, remove } from 'fs-extra'
import { describe, expect, it, vi } from 'vitest'

import {
  findUnsafeNodeOption,
  findUnsafeUiValues,
  isLogCommandAllowed,
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
