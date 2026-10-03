import helmet from '@fastify/helmet'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { helmetOptions } from '../../src/core/helmet.config.js'

describe('helmet configuration', () => {
  const app = Fastify()

  beforeAll(async () => {
    await app.register(helmet, helmetOptions({ allowedFrameAncestors: ['https://dashboard.example.com'] }))
    app.get('/', async () => 'ok')
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  async function csp(): Promise<Map<string, string>> {
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: 'hb.local:8581' } })
    const header = String(res.headers['content-security-policy'])
    return new Map(header.split(';').map(d => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/)
      return [name, values.join(' ')]
    }))
  }

  it('only lets forms submit to this origin', async () => {
    // form-action does not fall back to default-src, so it must be explicit
    expect((await csp()).get('form-action')).toBe('\'self\'')
  })

  it('keeps the rest of the policy', async () => {
    const directives = await csp()
    expect(directives.get('default-src')).toBe('\'self\'')
    expect(directives.get('script-src')).toBe('\'self\' \'unsafe-eval\'')
    expect(directives.get('script-src-attr')).toBe('\'none\'')
    expect(directives.get('frame-ancestors')).toBe('\'self\' https://dashboard.example.com')
    expect(directives.get('connect-src')).toContain('wss://hb.local:8581 ws://hb.local:8581')
    expect(directives.has('object-src')).toBe(false)
    expect(directives.has('upgrade-insecure-requests')).toBe(false)
  })
})
