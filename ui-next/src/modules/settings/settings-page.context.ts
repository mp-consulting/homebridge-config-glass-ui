import type { FieldKey, SavingKey, SettingsFieldValues, SettingsPage, SettingsPageState } from '@/modules/settings/settings-page.store'

import { createContext, use } from 'react'
import { useStore } from 'zustand'

/** The settings page the sections belong to (provided by `<Settings/>`). */
export const SettingsPageContext = createContext<SettingsPage | null>(null)

export function useSettingsPage(): SettingsPage {
  const page = use(SettingsPageContext)
  if (!page) {
    throw new Error('useSettingsPage() must be used inside <Settings/>')
  }
  return page
}

/**
 * Read part of the page state, re-rendering when it changes. Select a single
 * value (or a stable reference): a selector that builds a new object every
 * call re-renders for ever.
 * @param selector - picks the value
 */
export function useSettingsPageState<T>(selector: (state: SettingsPageState) => T): T {
  return useStore(useSettingsPage().store, selector)
}

/** A field's value, and the function that changes it the way the user does. */
export function useField<K extends FieldKey>(field: K): [SettingsFieldValues[K], (value: SettingsFieldValues[K]) => void] {
  const page = useSettingsPage()
  const value = useStore(page.store, state => state.values[field])
  return [value, (next: SettingsFieldValues[K]) => page.change(field, next)]
}

export function useSaving(key: SavingKey): boolean {
  return useSettingsPageState(state => !!state.saving[key])
}

export function useInvalid(key: FieldKey): boolean {
  return useSettingsPageState(state => !!state.invalid[key])
}

export function useDisabled(key: FieldKey): boolean {
  return useSettingsPageState(state => !!state.disabled[key])
}

/** Whether the search hides a row. */
export function useItemHidden(itemId: string): boolean {
  return useSettingsPageState(state => !!state.hiddenItems[itemId])
}
