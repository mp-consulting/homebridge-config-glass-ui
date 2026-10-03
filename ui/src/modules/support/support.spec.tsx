import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settingsActions, useSettingsStore } from '@/core/settings'
import { environment } from '@/environments/environment'
import { Support } from '@/modules/support/Support'
import { swaggerUrl } from '@/modules/support/swagger-url'
import { makeSettingsState, renderWithProviders } from '@/testing'

/**
 * The support page. Mostly a list of links out to documentation, Discord and
 * Reddit, so there is little logic — but the links themselves are worth checking:
 *
 * ⚠️ **every external link opens in a new tab, and must say `noopener`.**
 * Without it the page that opens can reach back through `window.opener` and
 * navigate this tab wherever it likes. There are around a dozen of them here and
 * one missing attribute is invisible on screen.
 */
describe('the support page', () => {
  let setPageTitle: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setPageTitle = vi.spyOn(settingsActions, 'setPageTitle')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createPage = () => renderWithProviders(<Support />, { route: '/support' })
  const toggles = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('.disclosure-toggle')]

  describe('the page itself', () => {
    it('sets the page title', () => {
      createPage()

      expect(setPageTitle).toHaveBeenCalledWith('support.title')
    })

    it('opens with both sections showing', () => {
      // Nothing here is long enough to be worth hiding by default
      const { container } = createPage()

      expect(container.querySelector('#fieldsGeneral')).not.toBeNull()
      expect(container.querySelector('#fieldsDev')).not.toBeNull()
    })

    it('hides a section when its heading is clicked', () => {
      const { container } = createPage()

      fireEvent.click(toggles(container)[0])

      expect(container.querySelector('#fieldsGeneral')).toBeNull()
      expect(toggles(container)[0].querySelector('i')?.className).toBe('fa fa-chevron-right')
    })

    it('brings a hidden section back', () => {
      const { container } = createPage()

      fireEvent.click(toggles(container)[1])
      fireEvent.click(toggles(container)[1])

      expect(container.querySelector('#fieldsDev')).not.toBeNull()
    })

    it('leaves the other section alone', () => {
      const { container } = createPage()

      fireEvent.click(toggles(container)[0])

      expect(container.querySelector('#fieldsDev')).not.toBeNull()
    })

    it('tells a screen reader which sections are open', () => {
      // The chevron says it visually; aria-expanded is the same fact for anyone
      // not looking at it
      const { container } = createPage()

      expect(toggles(container)).toHaveLength(2)
      expect(toggles(container).map(button => button.getAttribute('aria-expanded'))).toEqual(['true', 'true'])
      expect(toggles(container).map(button => button.getAttribute('aria-controls'))).toEqual(['fieldsGeneral', 'fieldsDev'])

      fireEvent.click(toggles(container)[0])

      expect(toggles(container)[0].getAttribute('aria-expanded')).toBe('false')
    })
  })

  describe('the links out', () => {
    /** Every anchor on the page, with both sections open. */
    function links(): HTMLAnchorElement[] {
      return [...createPage().container.querySelectorAll<HTMLAnchorElement>('a[href]')]
    }

    it('has links to offer', () => {
      // Otherwise the assertions below check an empty list
      expect(links().length).toBeGreaterThan(5)
    })

    it('opens each one in a new tab without handing over this one', () => {
      // Collected rather than asserted one by one, so a failure names every
      // link that is wrong instead of stopping at the first
      const unsafe = links()
        .filter(link => link.getAttribute('target') !== '_blank' || link.getAttribute('rel') !== 'noopener noreferrer')
        .map(link => link.getAttribute('href'))

      expect(unsafe).toEqual([])
    })

    it('never links off the box over plain http', () => {
      // ⚠️ The api documentation link is deliberately excluded: it points at the
      // user's own homebridge instance, which is plain http unless they have set
      // up a certificate. Everything that leaves the network must be https
      const offTheBox = links().filter((link) => {
        const href = link.getAttribute('href') ?? ''
        return !href.startsWith('/') && !href.startsWith(environment.api.origin)
      })

      expect(offTheBox.length).toBeGreaterThan(5)
      for (const link of offTheBox) {
        expect(link.getAttribute('href')).toMatch(/^https:\/\//)
      }
    })

    it('says what each link is, for anyone who cannot see the icon', () => {
      // Every one of these is an icon-only button
      const unnamed = links()
        .filter(link => !link.getAttribute('aria-label'))
        .map(link => link.getAttribute('href'))

      expect(unnamed).toEqual([])
    })
  })

  describe('the link to the api documentation', () => {
    it('is a path on the same host in production', () => {
      // Served by the homebridge backend itself, whatever host and port that is
      const original = environment.production
      try {
        environment.production = true

        expect(swaggerUrl()).toBe('/swagger')
      } finally {
        environment.production = original
      }
    })

    it('points at the backend when running the dev server', () => {
      // The dev server serves the UI on another port, so a relative path 404s
      useSettingsStore.setState(makeSettingsState({ env: { swaggerEnabled: true } as never }))
      expect(swaggerUrl()).toBe(`${environment.api.origin}/swagger`)
      expect(createPage().container.querySelector('#fieldsDev a')?.getAttribute('href')).toBe(`${environment.api.origin}/swagger`)
    })

    it('is not offered when the server does not serve the docs', () => {
      // Production servers do not mount /swagger: unauthenticated api docs
      // map the whole api for anyone who can reach the port
      useSettingsStore.setState(makeSettingsState({ env: { swaggerEnabled: false } as never }))
      const hrefs = [...createPage().container.querySelectorAll('#fieldsDev a')].map(a => a.getAttribute('href'))

      expect(hrefs.some(href => href?.endsWith('/swagger'))).toBe(false)
      expect(hrefs.length).toBeGreaterThan(0)
    })
  })
})
