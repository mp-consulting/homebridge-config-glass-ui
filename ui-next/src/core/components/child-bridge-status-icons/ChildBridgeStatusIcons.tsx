import type { ChildBridgeStatusResponse } from '@/core/interfaces/server.interfaces'
import type { ReactElement } from 'react'

import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import { useSettingsStore } from '@/core/settings'

/** Just the parts of a child bridge these icons read - so a caller holding a partial record can still use them */
export type ChildBridgeIconSource = Pick<ChildBridgeStatusResponse, 'status' | 'hap' | 'matterConfig'> & {
  restarting?: boolean
}

function classes(base: string, flags: Record<string, boolean>): string {
  return [base, ...Object.entries(flags).filter(([, on]) => on).map(([name]) => name)].join(' ')
}

/** The ngbTooltip the icons had: on hover only, to the right, after 150ms. */
function WithTooltip({ text, children }: { text: string, children: ReactElement }) {
  return (
    <OverlayTrigger placement="right" trigger={['hover']} delay={{ show: 150, hide: 0 }} overlay={<Tooltip>{text}</Tooltip>}>
      {children}
    </OverlayTrigger>
  )
}

/**
 * The HAP and Matter status icons for a single child bridge, with the colour
 * and tooltip vocabulary the bridges widget established: green running, amber
 * restarting or pending, red down, muted grey disabled, info externals-only.
 *
 * Extracted so the bridges widget and Update All's post-run restart list show
 * one bridge the same way, rather than each carrying its own copy of these
 * rules and drifting.
 */
export function ChildBridgeStatusIcons({ bridge, serverRestarting = false }: {
  bridge: ChildBridgeIconSource
  /** A whole-Homebridge restart puts every bridge in transition, whatever its own flag says */
  serverRestarting?: boolean
}) {
  const { t } = useTranslation()
  const featureFlags = useSettingsStore(state => state.env.featureFlags)
  const isMatterSupported = featureFlags?.matterSupport ?? false
  const isHapBridgeDisableSupported = featureFlags?.hapBridgeDisable ?? false
  const isProtocolExternalsOnlyEnabled = featureFlags?.protocolExternalsOnly ?? false

  const inTransition = bridge.status === 'pending' || !!bridge.restarting || serverRestarting
  const isDown = bridge.status === 'down' && !inTransition
  const isUp = bridge.status === 'ok' && !inTransition

  const hap = bridge.hap
  // Tolerates both the legacy boolean `hap` and the nested object form
  const hapDisabled = isHapBridgeDisableSupported
    && (hap === false || (typeof hap === 'object' && hap !== null && hap.enabled === false))
  const hapExternalsOnly = isProtocolExternalsOnlyEnabled
    && typeof hap === 'object' && hap !== null && hap.externalsOnly === true

  const matterExternalsOnly = isProtocolExternalsOnlyEnabled && bridge.matterConfig?.externalsOnly === true
  // Matches the widget exactly: no matterConfig at all means Matter is not configured for this bridge
  const matterEnabled = !!bridge.matterConfig && bridge.matterConfig.enabled !== false

  const hapTooltipKey = hapExternalsOnly
    ? 'status.services.hap_externals_only'
    : hapDisabled
      ? 'status.services.hap_not_enabled'
      : isDown ? 'status.services.hap_not_running' : 'status.services.hap_running'

  const matterTooltipKey = matterExternalsOnly
    ? 'status.services.matter_externals_only'
    : !matterEnabled
        ? 'status.services.matter_not_enabled'
        : isDown ? 'status.services.matter_not_running' : 'status.services.matter_running'

  const hapColoured = !hapDisabled && !hapExternalsOnly
  const matterColoured = !matterExternalsOnly && matterEnabled

  // An inline wrapper, like Angular's <app-child-bridge-status-icons> host: its
  // line box (the parent's line-height) sets the height of the row it sits in
  return (
    <span className="hb-child-bridge-status-icons">
      <WithTooltip text={t(hapTooltipKey)}>
        <i
          aria-hidden="true"
          className={classes('fas fa-hap fa-sm', {
            'green-text': hapColoured && isUp,
            'text-warning': hapColoured && inTransition,
            'red-text': hapColoured && isDown,
            'grey-text': hapDisabled && !hapExternalsOnly,
            'opacity-muted': hapDisabled && !hapExternalsOnly,
            'text-info': hapExternalsOnly,
          })}
        >
        </i>
      </WithTooltip>
      {isMatterSupported && (
        <WithTooltip text={t(matterTooltipKey)}>
          <i
            aria-hidden="true"
            className={classes('fas fa-matter fa-sm ms-2', {
              'green-text': matterColoured && isUp,
              'text-warning': matterColoured && inTransition,
              'red-text': matterColoured && isDown,
              'grey-text': !matterEnabled && !matterExternalsOnly,
              'opacity-muted': !matterEnabled && !matterExternalsOnly,
              'text-info': matterExternalsOnly,
            })}
          >
          </i>
        </WithTooltip>
      )}
    </span>
  )
}
