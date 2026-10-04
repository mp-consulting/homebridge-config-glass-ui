import type { FakeApi, FakeToast } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as toastModule from '@/core/ui/toast'
import { activeModalStub, fakeApi, renderWithProviders } from '@/testing'

import { normaliseConfigText } from './backup-diff'
import { ConfigBackupDiff } from './ConfigBackupDiff'

const diff = vi.hoisted(() => ({ props: undefined as any }))

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
// Monaco needs a real browser: record what the diff editor was given
vi.mock('@/core/monaco', () => ({
  MonacoDiffEditor: (props: any) => {
    diff.props = props
    return <div data-testid="monaco-diff-editor" />
  },
}))

describe('the config backup comparison', () => {
  const toast = (toastModule as unknown as { toast: FakeToast }).toast
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>

  async function open(currentConfig = '{"bridge":{"name":"New"}}') {
    renderWithProviders(
      <ConfigBackupDiff activeModal={{ ...activeModal, update: vi.fn() }} backupId="1001" timestamp="2026-08-16T02:00:00.000Z" currentConfig={currentConfig} />,
    )
    await act(async () => {})
  }

  beforeEach(() => {
    diff.props = undefined
    api = fakeApi().respond('get', '/config-editor/backups/1001', { bridge: { name: 'Old' } })
    activeModal = activeModalStub()
    toast.shown.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('compares the backup (left) with the current config (right), read-only', async () => {
    await open()

    expect(screen.getByTestId('monaco-diff-editor')).toBeInTheDocument()
    expect(diff.props.original).toBe('{\n    "bridge": {\n        "name": "Old"\n    }\n}')
    expect(diff.props.modified).toBe('{\n    "bridge": {\n        "name": "New"\n    }\n}')
    expect(diff.props.options).toMatchObject({ readOnly: true, originalEditable: false, renderSideBySide: true })
  })

  it('says so when nothing differs, formatting aside', async () => {
    await open('{ "bridge": { "name": "Old" } }')

    expect(screen.getByRole('status')).toHaveTextContent('config.restore.compare_identical')
    expect(screen.queryByTestId('monaco-diff-editor')).toBeNull()
  })

  it('switches between side-by-side and inline', async () => {
    await open()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /config.restore.view_inline/ }))
    })

    expect(diff.props.options.renderSideBySide).toBe(false)
  })

  it('closes with load to copy the backup into the editor', async () => {
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'config.restore.copy_to_editor' }))

    expect(activeModal.close).toHaveBeenCalledWith('load')
  })

  it('gives up, with a toast, when the backup cannot be read', async () => {
    api.fail('get', '/config-editor/backups/1001', { status: 404, error: { message: 'Backup 1001 Not Found' } })
    await open()

    expect(toast.at('error')[0].message).toBe('Backup 1001 Not Found')
    expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
  })

  it('compares unparseable editor text as typed', () => {
    expect(normaliseConfigText('{ broken')).toBe('{ broken')
    expect(normaliseConfigText('{"a":1}')).toBe('{\n    "a": 1\n}')
  })
})
