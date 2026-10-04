import type { AuditPage } from '@/modules/settings/audit/AuditLogModal'
import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuditLogModal } from '@/modules/settings/audit/AuditLogModal'
import { activeModalStub, fakeApi, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

function page(n: number, total: number): AuditPage {
  return {
    page: n,
    limit: 25,
    total,
    entries: [
      { at: '2026-10-04T10:00:00.000Z', action: 'plugin.install', actor: { username: 'admin', via: 'session' }, ok: true, target: 'homebridge-hue' },
      { at: '2026-10-04T09:00:00.000Z', action: 'api-token.request', actor: { username: 'admin', via: 'api-token', tokenId: 't1' }, ok: false, target: 'PUT /server/restart', error: 'boom' },
    ],
  }
}

describe('settings: audit log', () => {
  let api: FakeApi

  beforeEach(() => {
    api = fakeApi()
  })

  it('lists the entries, newest first, with who and how', async () => {
    api.respond('get', '/audit', (call: { options?: { params?: { page?: number } } }) => page(call.options?.params?.page ?? 1, 30))
    renderWithProviders(<AuditLogModal activeModal={activeModalStub() as any} />)
    await act(async () => {})

    const rows = screen.getByTestId('audit-table').querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('plugin.install')
    expect(rows[0]).toHaveTextContent('homebridge-hue')
    expect(rows[0]).toHaveTextContent('settings.audit.ok')
    expect(rows[1]).toHaveTextContent('settings.audit.via_token')
    expect(rows[1]).toHaveTextContent('settings.audit.failed')
    expect(api.lastCall('get', '/audit')?.options?.params).toMatchObject({ page: 1, limit: 25 })
  })

  it('pages and filters', async () => {
    api.respond('get', '/audit', page(1, 30))
    renderWithProviders(<AuditLogModal activeModal={activeModalStub() as any} />)
    await act(async () => {})

    expect(screen.getByRole('button', { name: 'settings.audit.previous' })).toBeDisabled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'settings.audit.next' }))
    })
    expect(api.lastCall('get', '/audit')?.options?.params).toMatchObject({ page: 2 })

    await act(async () => {
      fireEvent.change(screen.getByLabelText('settings.audit.filter_action'), { target: { value: 'plugin' } })
    })
    expect(api.lastCall('get', '/audit')?.options?.params).toMatchObject({ page: 1, action: 'plugin' })
  })

  it('says when nothing is recorded', async () => {
    api.respond('get', '/audit', { entries: [], total: 0, page: 1, limit: 25 })
    renderWithProviders(<AuditLogModal activeModal={activeModalStub() as any} />)
    await act(async () => {})
    expect(screen.getByTestId('audit-empty')).toHaveTextContent('settings.audit.empty')
  })
})
