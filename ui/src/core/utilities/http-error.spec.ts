import { describe, expect, it, vi } from 'vitest'

import { toToastMessage } from '@/core/utilities/http-error'

vi.mock('@/core/ui/i18n', () => ({
  i18n: { t: vi.fn((key: string) => key) },
}))

describe('toToastMessage', () => {
  it('shows the message the server sent', () => {
    expect(toToastMessage({ error: { message: 'Username already taken' } })).toBe('Username already taken')
  })

  it.each([
    ['a blank server message', { error: { message: '   ' } }],
    ['a non-string server message', { error: { message: { detail: 'nope' } } }],
    ['no error body', { status: 500 }],
    ['a locally thrown error', new Error('LevelControl cluster not found')],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to the generic message for %s', (_case, err) => {
    // translate returns the key itself, which is the point: the assertion pins
    // the key, not the English wording
    expect(toToastMessage(err)).toBe('toast.api_error_generic')
  })
})
