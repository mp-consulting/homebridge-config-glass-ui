import { describe, expect, it } from 'vitest'

import { loginThrottleSource } from '../../src/core/auth/auth.service.js'

describe('loginThrottleSource', () => {
  it.each([
    ['192.0.2.7', '192.0.2.7'],
    ['::ffff:192.0.2.7', '192.0.2.7'],
    ['2001:db8:1:2::5', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['fe80::1%en0', 'fe80:0:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['', ''],
    [undefined, ''],
  ])('%s -> %s', (input, expected) => {
    expect(loginThrottleSource(input)).toBe(expected)
  })
})
