import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HomebridgeDeconz } from '@/core/plugins/custom-plugins/homebridge-deconz/HomebridgeDeconz'
import { HomebridgeHue } from '@/core/plugins/custom-plugins/homebridge-hue/HomebridgeHue'
import { toast } from '@/core/ui/toast'
import { fileSaver } from '@/core/utilities/file-saver'
import { fakeApi, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

/**
 * The two settings components the UI ships on behalf of a plugin, both of which
 * do exactly one thing: download that plugin's diagnostic dump.
 *
 * They are near-identical copies of each other, which is precisely the risk —
 * the endpoint, the filename and the error message all name the plugin, and a
 * copy-paste that misses one of them is invisible until a user downloads a hue
 * dump and gets a deconz error. So each rule is asserted against both.
 */
describe('the vendored plugin settings components', () => {
  let api: FakeApi
  let saveAs: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    api = fakeApi()
    saveAs = vi.spyOn(fileSaver, 'saveAs').mockImplementation(() => {})
    saveAs.mockClear()
    vi.mocked(toast.error).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
  })

  async function download(plugin: 'homebridge-hue' | 'homebridge-deconz') {
    renderWithProviders(plugin === 'homebridge-hue' ? <HomebridgeHue /> : <HomebridgeDeconz />)
    fireEvent.click(screen.getByRole('button', { name: /plugins.settings.custom.download_dump_file/ }))
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  describe.each([
    ['homebridge-hue' as const, 'plugins.settings.hue.dump_no_exist'],
    ['homebridge-deconz' as const, 'plugins.settings.deconz.dump_no_exist'],
  ])('%s', (plugin, errorKey) => {
    it('asks for its own dump endpoint, as a blob', async () => {
      api.respond('get', `/plugins/custom-plugins/${plugin}/dump-file`, new Blob(['dump']))

      await download(plugin)

      expect(api.lastCall('get')?.url).toBe(`/plugins/custom-plugins/${plugin}/dump-file`)
      // Without this the response arrives parsed and the saved file is a corrupt gzip
      expect(api.lastCall('get')?.options).toEqual({ responseType: 'blob' })
    })

    it('saves it under its own name', async () => {
      const blob = new Blob(['dump'])
      api.respond('get', `/plugins/custom-plugins/${plugin}/dump-file`, blob)

      await download(plugin)

      expect(saveAs).toHaveBeenCalledWith(blob, `${plugin}.json.gz`)
    })

    it('shows its own message when the plugin has never written a dump', async () => {
      api.fail('get', `/plugins/custom-plugins/${plugin}/dump-file`, new Error('404'))

      await download(plugin)

      expect(toast.error).toHaveBeenCalledWith(errorKey, 'toast.title_error')
      expect(console.error).toHaveBeenCalled()
    })

    it('saves nothing when the download failed', async () => {
      api.fail('get', `/plugins/custom-plugins/${plugin}/dump-file`, new Error('404'))

      await download(plugin)

      expect(saveAs).not.toHaveBeenCalled()
    })
  })
})
