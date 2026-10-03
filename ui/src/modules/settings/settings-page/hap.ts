import type { PageContext } from '@/modules/settings/settings-page/types'

import { api } from '@/core/api'
import { Confirm } from '@/core/components/confirm/Confirm'
import { settingsActions } from '@/core/settings'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { MODAL_OPTIONS, t } from '@/modules/settings/settings-page/shared'

/** HAP: reading its config, and saving the toggle and its flags. */
export function createHapSlice(ctx: PageContext) {
  const { v, flags, patch, arm, setSaving, reportError, finishSaving, deps } = ctx

  const slice = {
    async initHapSettings(): Promise<void> {
      try {
        const { enabled, externalsOnly, disableIdentifyingMaterial } = await api.get<{ enabled: boolean, externalsOnly?: boolean, disableIdentifyingMaterial?: boolean }>('/config-editor/hap')
        patch('hapEnabled', enabled)
        patch('hapExternalsOnly', externalsOnly === true)
        patch('hapDisableIdentifyingMaterial', disableIdentifyingMaterial === true)
      } catch (error) {
        console.error(error)
        // Fall back to enabled (default) — arm regardless so user can change it
        patch('hapEnabled', true)
        patch('hapExternalsOnly', false)
        patch('hapDisableIdentifyingMaterial', false)
      }
      arm('hapEnabled')
      if (flags().isProtocolExternalsOnlyEnabled) {
        arm('hapExternalsOnly')
      }
      if (flags().isHapDisableIdentifyingMaterialEnabled) {
        arm('hapDisableIdentifyingMaterial')
      }
    },

    /**
     * Save the HAP externalsOnly flag. Only meaningful when HAP is disabled.
     * Re-uses the existing /hap endpoint with `enabled: false` plus the new
     * `externalsOnly` field, which the backend writes alongside enabled: false.
     * @param value - the flag
     */
    async hapExternalsOnlySave(value: boolean): Promise<void> {
      if (v().hapEnabled !== false) {
        // Defensive: should be hidden in the UI but guard against direct invocation.
        return
      }
      try {
        setSaving('hapExternalsOnly', true)
        await api.put('/config-editor/hap', {
          enabled: false,
          externalsOnly: value,
          disableIdentifyingMaterial: v().hapDisableIdentifyingMaterial === true,
          restart: false,
        })
        await ctx.page.requestFullServiceRestart()
      } catch (error) {
        reportError(error)
        patch('hapExternalsOnly', !value)
      } finally {
        setSaving('hapExternalsOnly', false)
      }
    },

    /**
     * Save whether HAP-NodeJS should omit username-derived identifying material
     * from bridge display names and mDNS service instance names.
     * @param value - the flag
     */
    async hapDisableIdentifyingMaterialSave(value: boolean): Promise<void> {
      try {
        setSaving('hapDisableIdentifyingMaterial', true)
        await api.put('/config-editor/hap', {
          enabled: v().hapEnabled !== false,
          externalsOnly: v().hapExternalsOnly === true,
          disableIdentifyingMaterial: value,
          restart: false,
        })
        await ctx.page.requestFullServiceRestart()
      } catch (error) {
        reportError(error)
        patch('hapDisableIdentifyingMaterial', !value)
      } finally {
        setSaving('hapDisableIdentifyingMaterial', false)
      }
    },

    async hapEnabledSave(value: boolean): Promise<void> {
      // Refuse to disable HAP unless Matter is enabled — at least one protocol is
      // required unless the running Homebridge supports disabling all protocols.
      if (!value && !v().matterEnabled && !flags().allowDisableAllProtocols) {
        toast.info(t('settings.hap.requires_matter'), t('toast.title_notice'))
        patch('hapEnabled', true)
        return
      }

      const identifyingMaterial = () => flags().isHapDisableIdentifyingMaterialEnabled
        ? v().hapDisableIdentifyingMaterial === true
        : undefined

      if (flags().allowMatterDisableInPlace) {
        // Non-destructive: HAP pairing is always preserved, so skip the confirm
        // modal and the immediate restart. Write the change, flag a full service
        // restart, and let the user restart via the toast when ready.
        try {
          setSaving('hapEnabled', true)
          const body: { enabled: boolean, restart: boolean, externalsOnly?: boolean, disableIdentifyingMaterial?: boolean } = { enabled: value, restart: false }
          // When disabling HAP, propagate the current externalsOnly setting (if the
          // feature is supported). When re-enabling, clear it from the form too;
          // the backend removes externalsOnly while retaining independent options.
          if (flags().isProtocolExternalsOnlyEnabled) {
            if (!value) {
              body.externalsOnly = v().hapExternalsOnly === true
            } else {
              patch('hapExternalsOnly', false)
            }
          }
          if (flags().isHapDisableIdentifyingMaterialEnabled) {
            body.disableIdentifyingMaterial = v().hapDisableIdentifyingMaterial === true
          }
          await api.put('/config-editor/hap', body)
          await ctx.page.requestFullServiceRestart()
        } catch (error) {
          reportError(error)
          patch('hapEnabled', !value)
        } finally {
          setSaving('hapEnabled', false)
        }
        return
      }

      try {
        setSaving('hapEnabled', true)
        if (value) {
          await api.put('/config-editor/hap', {
            enabled: true,
            disableIdentifyingMaterial: identifyingMaterial(),
          })
          finishSaving('hapEnabled', () => settingsActions.showRestartToast())
        } else {
          // Disabling HAP — confirm first
          const ref = openModal(Confirm, {
            title: t('settings.hap.disable'),
            message: t('settings.hap.disable_desc'),
            message2: t('common.phrases.are_you_sure'),
            confirmButtonLabel: t('form.button_continue'),
            confirmButtonClass: 'btn-danger',
            faIconClass: 'fas fa-exclamation-triangle text-warning',
          }, MODAL_OPTIONS)

          try {
            await ref.result

            settingsActions.clearRestartToast()

            deps.navigate('/restart?alreadyRestarting=true')
            await api.put('/config-editor/hap', {
              enabled: false,
              disableIdentifyingMaterial: identifyingMaterial(),
            })
          } catch (error) {
            if (error !== 'Dismiss') {
              reportError(error)
            }
            patch('hapEnabled', true)
            setSaving('hapEnabled', false)
          }
        }
      } catch (error) {
        reportError(error)
        patch('hapEnabled', !value)
        setSaving('hapEnabled', false)
      }
    },
  }

  return slice
}

export type HapSlice = ReturnType<typeof createHapSlice>
