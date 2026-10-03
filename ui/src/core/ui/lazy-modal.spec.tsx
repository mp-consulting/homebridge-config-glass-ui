import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FanManage as RealFanManage } from '@/core/accessories/types/hap/fan/FanManage'
import { FanManage } from '@/core/accessories/types/hap/lazy-manage'
import { MatterThermostatManage } from '@/core/accessories/types/matter/lazy-manage'
import { MatterThermostatManage as RealMatterThermostatManage } from '@/core/accessories/types/matter/thermostat/MatterThermostatManage'
import { lazyModal } from '@/core/ui/lazy-modal'

interface Props {
  name: string
  activeModal?: { dismiss: (reason?: unknown) => void }
}

function Greeting({ name }: Props) {
  return <p>{`Hello ${name}`}</p>
}

/**
 * The accessory manage modals are opened through these stand-ins, so their
 * code (and nouislider) is only downloaded when one is opened.
 */
describe('lazyModal', () => {
  it('renders the real component once it has loaded, with the props it was given', async () => {
    const load = vi.fn(async () => Greeting)
    const LazyGreeting = lazyModal(load)

    render(<LazyGreeting name="tile" />)

    expect(await screen.findByText('Hello tile')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('loads once and renders straight away on the next open', async () => {
    const load = vi.fn(async () => Greeting)
    const LazyGreeting = lazyModal(load)
    await LazyGreeting.preload()

    render(<LazyGreeting name="again" />)

    // No wait: the component is already there
    expect(screen.getByText('Hello again')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('dismisses the modal when the code cannot be loaded, and tries again next time', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('chunk failed')
    const load = vi.fn<() => Promise<typeof Greeting>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(Greeting)
    const LazyGreeting = lazyModal(load)
    const activeModal = { dismiss: vi.fn() }

    const { container } = render(<LazyGreeting name="x" activeModal={activeModal} />)

    await waitFor(() => expect(activeModal.dismiss).toHaveBeenCalledWith(failure))
    expect(container).toBeEmptyDOMElement()

    await expect(LazyGreeting.preload()).resolves.toBe(Greeting)
    expect(load).toHaveBeenCalledTimes(2)
    vi.mocked(console.error).mockRestore()
  })

  it('stands in for the real accessory manage modals', async () => {
    await expect(FanManage.preload()).resolves.toBe(RealFanManage)
    await expect(MatterThermostatManage.preload()).resolves.toBe(RealMatterThermostatManage)
  })
})
