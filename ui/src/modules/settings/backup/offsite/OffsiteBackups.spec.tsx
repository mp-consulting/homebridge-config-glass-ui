import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeApi, renderWithProviders } from '@/testing'

import { OffsiteBackups } from './OffsiteBackups'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const SETTINGS = {
  keepLocal: null,
  webdav: { enabled: true, url: 'https://cloud.example.com/dav/hb/', username: 'me', password: '********', keep: 7 },
  s3: { enabled: false, endpoint: '', region: 'us-east-1', bucket: '', prefix: 'homebridge/', accessKeyId: '', secretAccessKey: '', forcePathStyle: true, keep: 7 },
  lastRun: { at: '2026-10-04T03:00:00Z', fileName: 'x', results: [{ destination: 'webdav', ok: false, error: 'HTTP 507' }] },
}

describe('the off-site backups dialog', () => {
  let api: FakeApi
  const activeModal = { close: vi.fn(), dismiss: vi.fn() }

  async function open() {
    api.respond('get', '/backup/destinations', SETTINGS)
    renderWithProviders(<OffsiteBackups activeModal={activeModal as any} />)
    await act(async () => {})
  }

  beforeEach(() => {
    api = fakeApi()
  })

  it('shows the destinations and the last upload', async () => {
    await open()

    expect(screen.getByLabelText('backup.offsite.webdav_url')).toHaveValue('https://cloud.example.com/dav/hb/')
    expect(screen.queryByLabelText('backup.offsite.s3_bucket')).toBeNull()
    expect(screen.getByTestId('offsite-last-run')).toHaveTextContent('WebDAV: HTTP 507')
  })

  it('tests a destination with the settings as typed', async () => {
    api.respond('post', '/backup/destinations/test', { destination: 'webdav', ok: true })
    await open()

    fireEvent.change(screen.getByLabelText('backup.offsite.username'), { target: { value: 'other' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'backup.offsite.test' })[0])
    await act(async () => {})

    expect(api.callsTo('post')[0].body).toEqual({ destination: 'webdav', settings: expect.objectContaining({ username: 'other', password: '********' }) })
  })

  it('saves everything but the last run, with the local retention', async () => {
    api.respond('put', '/backup/destinations', SETTINGS)
    await open()

    fireEvent.click(screen.getByLabelText('backup.offsite.keep_count', { selector: 'input[type=radio]' }))
    fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    await act(async () => {})

    const body = api.callsTo('put')[0].body
    expect(body.keepLocal).toBe(7)
    expect(body).not.toHaveProperty('lastRun')
  })
})
