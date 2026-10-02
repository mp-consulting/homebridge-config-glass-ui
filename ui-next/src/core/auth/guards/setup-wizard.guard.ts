import type { Guard } from './guard-utils'

import { settingsActions, useSettingsStore } from '@/core/settings'

import { redirect } from './guard-utils'

/** The setup wizard, on a fresh install only (Angular `setupWizardGuard`). */
export const setupWizardGuard: Guard = async () => {
  await settingsActions.whenLoaded()

  if (useSettingsStore.getState().env.setupWizardComplete === false) {
    return null
  }

  return redirect('/')
}
