import type { PageContext } from '@/modules/settings/settings-page/types'
import type { SettingsSection } from '@/modules/settings/settings-search'

import { allSections, filterSettings, getUnavailableItems, isSectionVisible } from '@/modules/settings/settings-search'

/** Searching and navigating the sections. */
export function createSearchSlice(ctx: PageContext) {
  const { store, get, v, flags } = ctx

  const slice = {
    toggleSearch(): void {
      const show = !get().showSearchBar
      store.setState({ showSearchBar: show })
      if (!show) {
        // Clear search when hiding
        slice.clearSearch()
      }
    },

    onSearchChange(value: string): void {
      store.setState({ searchQuery: value })
      slice.filterSettings()
    },

    clearSearch(): void {
      store.setState({ searchQuery: '' })
      slice.filterSettings()
    },

    filterSettings(): void {
      store.setState({ hiddenItems: filterSettings(get().searchQuery, slice.getUnavailableItems()) })
    },

    getUnavailableItems(): string[] {
      const { platform, runningOnRaspberryPi, runningInDocker, isMatterDisableIpv4Enabled, isHapDisableIdentifyingMaterialEnabled, enableTerminalAccess } = flags()
      return getUnavailableItems({
        platform,
        runningOnRaspberryPi,
        runningInDocker,
        isMatterDisableIpv4Enabled,
        isHapDisableIdentifyingMaterialEnabled,
        enableTerminalAccess,
        matterEnabled: v().matterEnabled,
        hbLogSize: v().hbLogSize,
        uiTerminalPersistence: v().uiTerminalPersistence,
        uiAuth: v().uiAuth,
      })
    },

    isItemHidden(itemId: string): boolean {
      return !!get().hiddenItems[itemId]
    },

    isSectionVisible(sectionName: string): boolean {
      return isSectionVisible(sectionName, get().searchQuery, get().hiddenItems)
    },

    sectionNav() {
      return allSections.filter(section =>
        (flags().isMatterSupported || !['hap', 'matter'].includes(section.key)) && slice.isSectionVisible(section.key),
      )
    },

    toggleSection(section: SettingsSection): void {
      store.setState(state => ({ showFields: { ...state.showFields, [section]: !state.showFields[section] } }))
    },

    /** Jump to a section from the index, opening it first if it was collapsed. */
    scrollToSection(key: SettingsSection): void {
      if (!get().showFields[key]) {
        store.setState(state => ({ showFields: { ...state.showFields, [key]: true } }))
      }
      store.setState({ activeSection: key })
      requestAnimationFrame(() => {
        document.getElementById(`settings-section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },

    /**
     * Highlight the section being read: the last one whose heading has scrolled
     * past the top quarter of the window.
     */
    updateActiveSection(): void {
      const nav = slice.sectionNav()
      const threshold = window.innerHeight * 0.25
      let current: SettingsSection | undefined = nav[0]?.key
      for (const section of nav) {
        const element = document.getElementById(`settings-section-${section.key}`)
        if (element && element.getBoundingClientRect().top <= threshold) {
          current = section.key
        }
      }
      // At the very bottom the last sections can never reach the threshold
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = nav.at(-1)?.key
      }
      if (current && current !== get().activeSection) {
        store.setState({ activeSection: current })
      }
    },
  }

  return slice
}

export type SearchSlice = ReturnType<typeof createSearchSlice>
