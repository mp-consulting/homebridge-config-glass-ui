import { resolve } from 'node:path'
import process from 'node:process'

import { writeJson } from 'fs-extra'
import { describe, expect, it } from 'vitest'

import { getStartupConfig } from '../../src/core/config/config.startup.js'
import { testStoragePath } from '../storage-path.js'

describe('getStartupConfig', () => {
  const configPath = resolve(testStoragePath, 'config.json')

  async function startupWith(ui: Record<string, unknown>) {
    process.env.UIX_CONFIG_PATH = configPath
    process.env.UIX_STORAGE_PATH = testStoragePath
    await writeJson(configPath, { bridge: {}, platforms: [{ platform: 'config', ...ui }] })
    return getStartupConfig()
  }

  it('records why HTTPS could not be enabled, instead of failing to start', async () => {
    const config = await startupWith({
      ssl: { key: resolve(testStoragePath, 'missing.key'), cert: resolve(testStoragePath, 'missing.crt') },
    })

    // Falls back to HTTP (so the UI stays reachable to fix it) - and says so
    expect(config.httpsOptions).toBeUndefined()
    expect(config.sslError).toMatch(/Could not load the configured certificate/)
  })

  it('reports nothing when SSL is not configured', async () => {
    const config = await startupWith({})

    expect(config.sslError).toBeUndefined()
  })
})
