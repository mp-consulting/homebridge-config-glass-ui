import type { PageContext } from '@/modules/settings/settings-page/types'

import { api } from '@/core/api'
import { Confirm } from '@/core/components/confirm/Confirm'
import { settingsActions } from '@/core/settings'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { MODAL_OPTIONS, t } from '@/modules/settings/settings-page/shared'

/** Matter: reading its config, and saving the toggle, port, port range and flags. */
export function createMatterSlice(ctx: PageContext) {
  const { v, flags, patch, arm, load, setSaving, setInvalid, reportError, finishSaving, internals, deps } = ctx

  const slice = {
    async initMatterSettings(): Promise<void> {
      try {
        const [matterConfig, matterPorts] = await Promise.all([
          api.get('/config-editor/matter'),
          api.get<{ start?: number, end?: number }>('/config-editor/matter/ports'),
        ])

        // null = Matter not configured. A block with `enabled: false` is the
        // in-place disabled state (configured but off) — treat it as disabled.
        const isEnabled = matterConfig !== null && matterConfig.enabled !== false

        // Remember the configured port (even when disabled in place) so re-enabling
        // reuses it and keeps the existing commissioning storage.
        if (matterConfig?.port || matterConfig?.disableIpv4) {
          internals.matterConfigCache = { port: matterConfig.port, disableIpv4: matterConfig.disableIpv4 === true || undefined }
        }

        if (isEnabled) {
          // Matter is enabled - populate fields with config values
          patch('matterPort', matterConfig.port || null)
        } else {
          // Matter is disabled - set default values but don't show fields
          patch('matterPort', 0)
        }

        arm('matterPort')

        // disableIpv4 toggle (Homebridge >= 2.2.0 only)
        patch('matterDisableIpv4', matterConfig?.disableIpv4 === true)
        if (flags().isMatterDisableIpv4Enabled) {
          arm('matterDisableIpv4')
        }

        // Matter port range
        load('matterStartPort', matterPorts.start ?? null)
        load('matterEndPort', matterPorts.end ?? null)

        // Set enabled state
        patch('matterEnabled', isEnabled)
        // externalsOnly is only meaningful when matter.enabled === false. Read
        // and arm regardless so toggling produces a save.
        patch('matterExternalsOnly', matterConfig?.externalsOnly === true)

        arm('matterEnabled')
        if (flags().isProtocolExternalsOnlyEnabled) {
          arm('matterExternalsOnly')
        }
      } catch (error) {
        console.error(error)
        // Don't show error toast - Matter might not be configured yet
        // Arm the toggle even if config doesn't exist yet
        arm('matterEnabled')
      }
    },

    /**
     * Save the Matter externalsOnly flag. Only meaningful when Matter is
     * disabled in place. Uses the existing /matter/enabled endpoint with
     * `enabled: false` plus the new `externalsOnly` field.
     * @param value - the flag
     */
    async matterExternalsOnlySave(value: boolean): Promise<void> {
      if (v().matterEnabled !== false) {
        return
      }
      try {
        setSaving('matterExternalsOnly', true)
        await api.put('/config-editor/matter/enabled', { enabled: false, externalsOnly: value, restart: false })
        await ctx.page.requestFullServiceRestart()
      } catch (error) {
        reportError(error)
        patch('matterExternalsOnly', !value)
      } finally {
        setSaving('matterExternalsOnly', false)
      }
    },

    /**
     * Save the Matter disableIpv4 flag. PUT /config-editor/matter replaces the
     * whole bridge.matter block, so the current port is sent alongside to
     * preserve it (and vice versa in matterPortSave).
     * @param value - the flag
     */
    async matterDisableIpv4Save(value: boolean): Promise<void> {
      try {
        setSaving('matterDisableIpv4', true)
        const port = v().matterPort
        await api.put('/config-editor/matter', {
          port: port || undefined,
          disableIpv4: value || undefined,
        })
        finishSaving('matterDisableIpv4', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        patch('matterDisableIpv4', !value)
        setSaving('matterDisableIpv4', false)
      }
    },

    async matterPortSave(value: number | null | undefined | ''): Promise<void> {
      // Port is optional - if empty/null/undefined, just save without validation
      if (!value && value !== 0) {
        // Empty value is valid (optional field)
        try {
          setSaving('matterPort', true)
          setInvalid('matterPort', false)
          await api.put('/config-editor/matter', {
            port: undefined,
            disableIpv4: v().matterDisableIpv4 || undefined,
          })
          finishSaving('matterPort', () => settingsActions.showRestartToast())
        } catch (error) {
          reportError(error)
          setSaving('matterPort', false)
        }
        return
      }

      // If a value is provided, validate it
      if (typeof value !== 'number' || value < 1024 || value > 65535 || Number.isInteger(value) === false) {
        setInvalid('matterPort', true)
        return
      }

      // Check for reserved ports
      if ([5353, 8080, 8443].includes(value)) {
        setInvalid('matterPort', true)
        toast.error(t('settings.matter.port_reserved', { ports: '5353, 8080, 8443' }), t('toast.title_error'))
        return
      }

      try {
        setSaving('matterPort', true)
        setInvalid('matterPort', false)
        await api.put('/config-editor/matter', {
          port: value,
          disableIpv4: v().matterDisableIpv4 || undefined,
        })
        finishSaving('matterPort', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('matterPort', false)
        setInvalid('matterPort', true)
      }
    },

    matterStartPortSave(value: number): Promise<void> {
      return ctx.page.portRangeSave('/config-editor/matter/ports', 'matterStartPort', value)
    },

    matterEndPortSave(value: number): Promise<void> {
      return ctx.page.portRangeSave('/config-editor/matter/ports', 'matterEndPort', value)
    },

    /** A port for matter: the cached one, else one the server picks, else one from the matter range. */
    async matterPortToUse(): Promise<number | undefined> {
      if (internals.matterConfigCache.port) {
        return internals.matterConfigCache.port
      }
      try {
        const portResponse = await api.get('/server/port/new/matter')
        return portResponse!.port
      } catch (error) {
        console.error('Failed to get Matter port, using fallback', error)
        // Fallback to Matter port range if API call fails
        return Math.floor(Math.random() * (5541 - 5530 + 1) + 5530)
      }
    },

    async matterEnabledSave(value: boolean): Promise<void> {
      // Refuse to disable Matter unless HAP is enabled — at least one protocol is
      // required unless the running Homebridge supports disabling all protocols.
      if (!value && !v().hapEnabled && !flags().allowDisableAllProtocols) {
        toast.info(t('settings.matter.requires_hap'), t('toast.title_notice'))
        patch('matterEnabled', true)
        return
      }

      if (flags().allowMatterDisableInPlace) {
        // Non-destructive: Matter commissioning is preserved (matter.enabled=false),
        // so skip the confirm modal and the immediate restart. Write the change,
        // flag a full service restart, and let the user restart via the toast.
        try {
          setSaving('matterEnabled', true)
          if (value) {
            // Enable: reuse the cached/allocated port. Writing the block clears any
            // `enabled: false`, and the preserved storage keeps commissioning.
            const port = await slice.matterPortToUse()
            const disableIpv4 = internals.matterConfigCache.disableIpv4 || undefined
            await api.put('/config-editor/matter', { port, disableIpv4 })
            if (port !== undefined) {
              patch('matterPort', port)
            }
            patch('matterDisableIpv4', disableIpv4 === true)
            internals.matterConfigCache = { port, disableIpv4 }
            // Re-enabling clears externalsOnly — validation rejects enabled + externalsOnly.
            if (flags().isProtocolExternalsOnlyEnabled) {
              patch('matterExternalsOnly', false)
            }
          } else {
            // Disable in place: keep the block, port and commissioning storage.
            internals.matterConfigCache = {
              port: v().matterPort || undefined,
              disableIpv4: v().matterDisableIpv4 || undefined,
            }
            const body: { enabled: boolean, restart: boolean, externalsOnly?: boolean } = { enabled: false, restart: false }
            if (flags().isProtocolExternalsOnlyEnabled) {
              body.externalsOnly = v().matterExternalsOnly === true
            }
            await api.put('/config-editor/matter/enabled', body)
          }
          await ctx.page.requestFullServiceRestart()
        } catch (error) {
          reportError(error)
          patch('matterEnabled', !value)
        } finally {
          setSaving('matterEnabled', false)
        }
        return
      }

      try {
        setSaving('matterEnabled', true)
        if (value) {
          // When enabling, restore cached port if it exists, otherwise query for available port
          const port = await slice.matterPortToUse()

          const disableIpv4 = internals.matterConfigCache.disableIpv4 || undefined
          await api.put('/config-editor/matter', {
            port,
            disableIpv4,
          })

          // Update the form value
          if (port !== undefined) {
            patch('matterPort', port)
          }
          patch('matterDisableIpv4', disableIpv4 === true)

          // Update cache with current value
          internals.matterConfigCache = { port, disableIpv4 }

          finishSaving('matterEnabled', () => settingsActions.showRestartToast())
        } else {
          // When disabling, show confirmation modal
          const ref = openModal(Confirm, {
            title: t('settings.matter.disable'),
            message: t(flags().allowMatterDisableInPlace ? 'settings.matter.disable_desc_in_place' : 'settings.matter.disable_desc'),
            message2: t('common.phrases.are_you_sure'),
            confirmButtonLabel: t('form.button_continue'),
            confirmButtonClass: 'btn-danger',
            faIconClass: 'fas fa-exclamation-triangle text-warning',
          }, MODAL_OPTIONS)

          try {
            // Wait for user confirmation
            await ref.result

            // User confirmed - cache the current port value before deleting
            internals.matterConfigCache = {
              port: v().matterPort || undefined,
            }

            // Hide the restart toast if it's shown
            settingsActions.clearRestartToast()

            deps.navigate('/restart?alreadyRestarting=true')
            if (flags().allowMatterDisableInPlace) {
              // Non-destructive disable: keep the config block + commissioning
              // storage, just mark Matter off so re-enabling needs no re-pairing.
              await api.put('/config-editor/matter/enabled', { enabled: false })
            } else {
              // Legacy teardown on older Homebridge: remove the block and its storage.
              await api.delete('/config-editor/matter')
            }
          } catch (error) {
            if (error !== 'Dismiss') {
              // Actual error - show error message
              reportError(error)
            }
            // Revert the toggle (the user cancelled, or it failed)
            patch('matterEnabled', true)
            setSaving('matterEnabled', false)
          }
        }
      } catch (error) {
        reportError(error)
        patch('matterEnabled', value)
        setSaving('matterEnabled', false)
      }
    },
  }

  return slice
}

export type MatterSlice = ReturnType<typeof createMatterSlice>
