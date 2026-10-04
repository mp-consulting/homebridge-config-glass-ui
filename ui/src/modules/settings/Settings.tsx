import type { SettingsPageDeps } from '@/modules/settings/settings-page.store'

import { isStandalonePWA } from 'is-standalone-pwa'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useStore } from 'zustand'

import { Spinner } from '@/core/components/spinner/Spinner'
import { cx } from '@/core/utilities/cx'
import { AssistantSection } from '@/modules/settings/sections/AssistantSection'
import { CacheSection } from '@/modules/settings/sections/CacheSection'
import { DisplaySection } from '@/modules/settings/sections/DisplaySection'
import { GeneralSection } from '@/modules/settings/sections/GeneralSection'
import { HapSection } from '@/modules/settings/sections/HapSection'
import { InstancesSection } from '@/modules/settings/sections/InstancesSection'
import { MatterSection } from '@/modules/settings/sections/MatterSection'
import { NetworkSection } from '@/modules/settings/sections/NetworkSection'
import { NotificationsSection } from '@/modules/settings/sections/NotificationsSection'
import { ResetSection } from '@/modules/settings/sections/ResetSection'
import { SecuritySection } from '@/modules/settings/sections/SecuritySection'
import { StartupSection } from '@/modules/settings/sections/StartupSection'
import { TerminalSection } from '@/modules/settings/sections/TerminalSection'
import { SettingsPageContext } from '@/modules/settings/settings-page.context'
import { createSettingsPage } from '@/modules/settings/settings-page.store'
import { isSectionVisible as sectionVisible } from '@/modules/settings/settings-search'

import './settings.scss'

/** Run `fn` at most every `ms`, on the leading and the trailing edge (rxjs `throttleTime`). */
function throttle(fn: () => void, ms: number): { run: () => void, cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  const run = () => {
    if (timer) {
      pending = true
      return
    }
    fn()
    timer = setTimeout(() => {
      timer = null
      if (pending) {
        pending = false
        run()
      }
    }, ms)
  }
  return {
    run,
    cancel: () => {
      if (timer) {
        clearTimeout(timer)
      }
      timer = null
      pending = false
    },
  }
}

export interface SettingsProps {
  /** Overrides for what the page takes from outside, for specs. */
  deps?: Partial<SettingsPageDeps>
}

/**
 * The settings page. Every control saves as soon as it settles; the state and
 * the saves live in `createSettingsPage()`, and each section of the page is
 * its own component under `sections/`.
 */
export function Settings({ deps }: SettingsProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  const [page] = useState(() => createSettingsPage({
    navigate: to => void navigateRef.current(to),
    isPwa: Boolean(isStandalonePWA()),
    ...deps,
  }))

  const loading = useStore(page.store, state => state.loading)
  const showSearchBar = useStore(page.store, state => state.showSearchBar)
  const searchQuery = useStore(page.store, state => state.searchQuery)
  const hiddenItems = useStore(page.store, state => state.hiddenItems)
  const activeSection = useStore(page.store, state => state.activeSection)
  const isThemeTransitioning = useStore(page.store, state => state.isThemeTransitioning)
  const isMatterSupported = useStore(page.store, state => state.flags.isMatterSupported)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void page.init()
    return () => page.destroy()
  }, [page])

  useEffect(() => {
    // Capture phase so it also sees scrolling of inner containers, not only the window
    const throttled = throttle(() => page.updateActiveSection(), 100)
    window.addEventListener('scroll', throttled.run, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', throttled.run, { capture: true })
      throttled.cancel()
    }
  }, [page])

  useEffect(() => {
    // Focus on search input once it is shown
    if (showSearchBar) {
      searchInputRef.current?.focus()
    }
  }, [showSearchBar])

  const isSectionVisible = (section: string) => sectionVisible(section, searchQuery, hiddenItems)
  const sectionNav = page.sectionNav()

  return (
    <SettingsPageContext value={page}>
      <div className="hb-settings">
        <div className="row mb-3">
          <div className="col-6">
            <h3 className="primary-text m-0">{t('menu.settings.title')}</h3>
          </div>
          <div className="col-6 text-end">
            <button
              type="button"
              className="btn btn-elegant my-0 me-0"
              aria-controls="settings-search-region"
              aria-label={t('form.search')}
              aria-expanded={showSearchBar}
              onClick={() => page.toggleSearch()}
            >
              <i aria-hidden="true" className={cx('fas fa-search', showSearchBar && 'primary-text')}></i>
            </button>
          </div>
        </div>

        {showSearchBar && (
          <div id="settings-search-region" className="row">
            <div className="col-md-12">
              <form noValidate onSubmit={event => event.preventDefault()}>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="search-bar"
                  aria-label={t('form.search')}
                  placeholder={t('form.search')}
                  value={searchQuery}
                  onChange={event => page.onSearchChange(event.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="search-bar-clear"
                    aria-label={t('form.button_clear')}
                    onClick={() => page.clearSearch()}
                  >
                    <i className="fas fa-square-xmark" aria-hidden="true"></i>
                  </button>
                )}
              </form>
            </div>
          </div>
        )}
        {loading
          ? <Spinner />
          : (
              <div className="settings-layout">
                <nav className="settings-nav" aria-label={t('menu.settings.title')}>
                  {sectionNav.map(section => (
                    <button
                      key={section.key}
                      type="button"
                      className={cx('settings-nav-item', activeSection === section.key && 'active')}
                      aria-current={activeSection === section.key ? 'true' : undefined}
                      onClick={() => page.scrollToSection(section.key)}
                    >
                      <i aria-hidden="true" className={section.icon}></i>
                      <span>{t(section.title)}</span>
                    </button>
                  ))}
                </nav>
                <div className={cx('settings-content', isThemeTransitioning && 'theme-transitioning')}>
                  {isSectionVisible('general') && <GeneralSection />}
                  {isSectionVisible('display') && <DisplaySection />}
                  {isSectionVisible('startup') && <StartupSection />}
                  {isSectionVisible('network') && <NetworkSection />}
                  {isMatterSupported && isSectionVisible('hap') && <HapSection />}
                  {isMatterSupported && isSectionVisible('matter') && <MatterSection />}
                  {isSectionVisible('terminal') && <TerminalSection />}
                  {isSectionVisible('security') && <SecuritySection />}
                  {isSectionVisible('assistant') && <AssistantSection />}
                  {isSectionVisible('notifications') && <NotificationsSection />}
                  {isSectionVisible('instances') && <InstancesSection />}
                  {isSectionVisible('cache') && <CacheSection />}
                  {isSectionVisible('reset') && <ResetSection />}
                  <div className="pb-3"></div>
                </div>
              </div>
            )}
      </div>
    </SettingsPageContext>
  )
}
