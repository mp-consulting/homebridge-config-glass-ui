import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { resolve } from 'node:path'
import process from 'node:process'

import { HttpService } from '@nestjs/axios'
import { NotFoundException } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, outputFile, outputJson, remove } from 'fs-extra'
import { of, throwError } from 'rxjs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { InstalledPluginsService } from '../../src/modules/plugins/installed-plugins.service.js'
import { PluginMetadataService } from '../../src/modules/plugins/plugin-metadata.service.js'
import { PluginsModule } from '../../src/modules/plugins/plugins.module.js'
import { testStoragePath } from '../storage-path.js'

/**
 * getPluginRelease / getPluginChangeLog against stubbed npm and GitHub
 * responses, through the public service methods only.
 */

type Responder = (url: string) => { status: number, data?: unknown } | undefined

function httpError(status: number, message = `Request failed with status code ${status}`) {
  return Object.assign(new Error(message), { response: { status, data: { message } } })
}

const GH_PLUGIN = 'homebridge-gh-plugin'
const OWNER_REPO = 'acme/homebridge-gh-plugin'
const RAW = `https://raw.githubusercontent.com/${OWNER_REPO}`
const API = `https://api.github.com/repos/${OWNER_REPO}`
const rateLimited = { status: 403, data: { message: 'API rate limit exceeded' } }

describe('PluginMetadataService releases and changelogs (e2e)', () => {
  let app: NestFastifyApplication
  let metadata: PluginMetadataService
  let httpService: HttpService
  let responder: Responder
  let requested: string[]

  const pluginsPath = resolve(testStoragePath, 'plugins/node_modules')

  const npmPackage = (name: string, distTags: Record<string, string>, homepage?: string) => ({
    'name': name,
    'dist-tags': distTags,
    'homepage': homepage,
  })

  /** The default npm answers: the package doc and /latest for the GitHub plugin */
  const npmResponses: Responder = (url) => {
    if (url === `https://registry.npmjs.org/${GH_PLUGIN}`) {
      return { status: 200, data: npmPackage(GH_PLUGIN, { latest: '1.2.0', beta: '2.0.0-beta.1' }) }
    }
    if (url === `https://registry.npmjs.org/${GH_PLUGIN}/latest`) {
      return { status: 200, data: { name: GH_PLUGIN, version: '1.2.0', homepage: `https://github.com/${OWNER_REPO}#readme` } }
    }
    if (url === 'https://registry.npmjs.org/homebridge') {
      return { status: 200, data: npmPackage('homebridge', { latest: '1.9.0' }) }
    }
    return undefined
  }

  const respond = (extra: Responder) => {
    responder = url => extra(url) ?? npmResponses(url)
  }

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    process.env.UIX_CUSTOM_PLUGIN_PATH = pluginsPath

    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await remove(pluginsPath)
    await copy(resolve(__dirname, '../mocks', 'plugins'), pluginsPath)
    // A plugin whose npm metadata points at a GitHub repo
    await outputJson(resolve(pluginsPath, GH_PLUGIN, 'package.json'), {
      name: GH_PLUGIN,
      version: '1.0.0',
      keywords: ['homebridge-plugin'],
      engines: { homebridge: '>=1.0.0' },
    })

    // Every request goes through the stub, including the plugin list the
    // registry loads in its constructor - so it is in place before compile
    httpService = new HttpService()
    responder = npmResponses
    requested = []
    vi.spyOn(httpService, 'get').mockImplementation(((url: string) => {
      requested.push(url)
      const res = responder(url)
      if (!res) {
        return throwError(() => httpError(404))
      }
      return res.status >= 400
        ? throwError(() => httpError(res.status, (res.data as any)?.message))
        : of({ data: res.data, status: res.status } as any)
    }) as any)

    const moduleFixture = await Test.createTestingModule({
      imports: [PluginsModule],
    }).overrideProvider(HttpService).useValue(httpService).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()

    metadata = app.get(PluginMetadataService)
    ;(app.get(InstalledPluginsService) as any)._paths = [pluginsPath]
  })

  beforeEach(() => {
    responder = npmResponses
    requested = []
  })

  afterAll(async () => {
    await app.close()
  })

  describe('getPluginRelease for an installed plugin', () => {
    it('returns the release notes and the changelog at the release tag', async () => {
      respond((url) => {
        if (url === `${API}/releases/tags/v1.2.0`) {
          return { status: 200, data: { tag_name: 'v1.2.0', body: 'Release notes' } }
        }
        if (url === `${RAW}/refs/tags/v1.2.0/CHANGELOG.md`) {
          return { status: 200, data: '# Changelog at v1.2.0' }
        }
        return undefined
      })

      expect(await metadata.getPluginRelease(GH_PLUGIN)).toEqual({
        name: 'v1.2.0',
        notes: 'Release notes',
        changelog: '# Changelog at v1.2.0',
        latestVersion: '1.2.0',
      })
    })

    it('falls back to the bare version tag and a lowercase changelog.md', async () => {
      respond((url) => {
        if (url === `${API}/releases/tags/1.1.0`) {
          return { status: 200, data: { tag_name: '1.1.0', body: 'Bare tag' } }
        }
        if (url === `${RAW}/refs/tags/1.1.0/changelog.md`) {
          return { status: 200, data: 'lowercase changelog' }
        }
        return undefined
      })

      expect(await metadata.getPluginRelease(GH_PLUGIN, '1.1.0')).toEqual({
        name: '1.1.0',
        notes: 'Bare tag',
        changelog: 'lowercase changelog',
        latestVersion: '1.2.0',
      })
      expect(requested).toContain(`${API}/releases/tags/v1.1.0`)
    })

    it('a GitHub 403 rate limit on the release falls back to the HEAD changelog', async () => {
      respond((url) => {
        if (url.startsWith(`${API}/releases/`)) {
          return rateLimited
        }
        if (url === `${RAW}/HEAD/CHANGELOG.md`) {
          return { status: 200, data: 'HEAD changelog' }
        }
        return undefined
      })

      expect(await metadata.getPluginRelease(GH_PLUGIN)).toEqual({
        name: null,
        notes: null,
        changelog: 'HEAD changelog',
        latestVersion: '1.2.0',
      })
    })

    it('rate-limited everywhere still answers, with nothing found', async () => {
      respond(url => url.includes('github') ? rateLimited : undefined)

      expect(await metadata.getPluginRelease(GH_PLUGIN)).toEqual({
        name: null,
        notes: null,
        changelog: null,
        latestVersion: '1.2.0',
      })
    })

    it('a missing release (404) and no changelog answers with nulls', async () => {
      expect(await metadata.getPluginRelease(GH_PLUGIN, '1.0.0')).toEqual({
        name: null,
        notes: null,
        changelog: null,
        latestVersion: '1.2.0',
      })
      expect(requested).toEqual(expect.arrayContaining([
        `${API}/releases/tags/v1.0.0`,
        `${API}/releases/tags/1.0.0`,
        `${RAW}/HEAD/CHANGELOG.md`,
        `${RAW}/HEAD/changelog.md`,
      ]))
    })

    it('resolves a dist-tag and reads a prerelease changelog from the matching branch', async () => {
      respond((url) => {
        if (url === `${API}/branches`) {
          return { status: 200, data: [{ name: 'main' }, { name: 'beta-2.0.0' }] }
        }
        if (url === `${RAW}/refs/heads/beta-2.0.0/CHANGELOG.md`) {
          return { status: 200, data: 'beta changelog' }
        }
        return undefined
      })

      expect(await metadata.getPluginRelease(GH_PLUGIN, 'beta')).toEqual({
        name: null,
        notes: null,
        changelog: 'beta changelog',
        latestVersion: '1.2.0',
      })
      expect(requested).toContain(`${API}/releases/tags/v2.0.0-beta.1`)
    })

    it('a rate-limited branch list falls back to the HEAD changelog for a prerelease', async () => {
      respond((url) => {
        if (url === `${API}/branches`) {
          return rateLimited
        }
        if (url === `${RAW}/HEAD/CHANGELOG.md`) {
          return { status: 200, data: 'HEAD changelog' }
        }
        return undefined
      })

      expect((await metadata.getPluginRelease(GH_PLUGIN, '2.0.0-beta.1')).changelog).toBe('HEAD changelog')
    })

    it('404s when npm does not know the plugin', async () => {
      respond(url => url === `https://registry.npmjs.org/${GH_PLUGIN}` ? { status: 404 } : undefined)

      await expect(metadata.getPluginRelease(GH_PLUGIN)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('404s when npm is rate limiting too', async () => {
      respond(url => url === `https://registry.npmjs.org/${GH_PLUGIN}` ? { status: 429 } : undefined)

      await expect(metadata.getPluginRelease(GH_PLUGIN)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('404s for a plugin that is not installed', async () => {
      respond(url => url === 'https://registry.npmjs.org/homebridge-not-installed'
        ? { status: 200, data: npmPackage('homebridge-not-installed', { latest: '1.0.0' }) }
        : undefined)

      await expect(metadata.getPluginRelease('homebridge-not-installed')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('404s for an installed plugin without a GitHub repo', async () => {
      respond(url => url === 'https://registry.npmjs.org/homebridge-mock-plugin'
        ? { status: 200, data: npmPackage('homebridge-mock-plugin', { latest: '1.0.0' }) }
        : undefined)

      await expect(metadata.getPluginRelease('homebridge-mock-plugin')).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('getPluginRelease for homebridge itself', () => {
    it('a rate-limited release still returns the HEAD changelog', async () => {
      respond((url) => {
        if (url.startsWith('https://api.github.com/repos/homebridge/homebridge/releases/')) {
          return rateLimited
        }
        if (url === 'https://raw.githubusercontent.com/homebridge/homebridge/HEAD/CHANGELOG.md') {
          return { status: 200, data: 'homebridge changelog' }
        }
        return undefined
      })

      expect(await metadata.getPluginRelease('homebridge')).toEqual({
        name: null,
        notes: null,
        changelog: 'homebridge changelog',
        latestVersion: '1.9.0',
      })
    })

    it('returns the release notes for the latest version', async () => {
      respond((url) => {
        if (url === 'https://api.github.com/repos/homebridge/homebridge/releases/tags/v1.9.0') {
          return { status: 200, data: { tag_name: 'v1.9.0', body: 'HB notes' } }
        }
        if (url === 'https://raw.githubusercontent.com/homebridge/homebridge/refs/tags/v1.9.0/CHANGELOG.md') {
          return { status: 200, data: 'tagged changelog' }
        }
        return undefined
      })

      expect(await metadata.getPluginRelease('homebridge', 'latest')).toEqual({
        name: 'v1.9.0',
        notes: 'HB notes',
        changelog: 'tagged changelog',
        latestVersion: '1.9.0',
      })
    })
  })

  describe('getPluginChangeLog', () => {
    it('returns the installed CHANGELOG.md', async () => {
      const { changelog } = await metadata.getPluginChangeLog('homebridge-mock-plugin')

      expect(changelog).toBeTruthy()
      expect(requested.some(url => url.includes('github'))).toBe(false)
    })

    it('404s when the installed plugin has no CHANGELOG.md', async () => {
      await expect(metadata.getPluginChangeLog(GH_PLUGIN)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('404s for a plugin that is not installed', async () => {
      await expect(metadata.getPluginChangeLog('homebridge-not-installed')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('reads the file fresh from disk', async () => {
      const path = resolve(pluginsPath, GH_PLUGIN, 'CHANGELOG.md')
      await outputFile(path, '# Added later')
      try {
        expect(await metadata.getPluginChangeLog(GH_PLUGIN)).toEqual({ changelog: '# Added later' })
      } finally {
        await remove(path)
      }
    })
  })
})
