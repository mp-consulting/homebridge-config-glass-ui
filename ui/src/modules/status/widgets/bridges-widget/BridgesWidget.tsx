import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'

import { api } from '@/core/api'
import { useAuthStore } from '@/core/auth'
import { ttlCache } from '@/core/caching'
import { ChildBridgeStatusIcons } from '@/core/components/child-bridge-status-icons/ChildBridgeStatusIcons'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { cx } from '@/core/utilities/cx'
import { ws } from '@/core/ws'

import { createBridgesStore } from './bridges.store'

import './bridges-widget.scss'

export function BridgesWidget({ widget }: WidgetProps) {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => state.user.admin)

  const [store] = useState(() => createBridgesStore({
    ws,
    api,
    cache: ttlCache,
    toastError: (message, title) => toast.error(message, title),
    t: (key, params) => i18n.t(key, params),
    isAdmin: !!isAdmin,
    isMatterSupported: settingsActions.isFeatureEnabled('matterSupport'),
  }))
  const bridges = useStore(store)

  useEffect(() => store.getState().connect(), [store])

  const status = bridges.homebridgeStatus
  const mainBusy = status?.status === 'pending' || bridges.isRestarting

  return (
    <div className="hb-bridges-widget flex-column d-flex align-items-stretch h-100 w-100 pb-3 overflow-auto no-scrollbars">
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {bridges.homebridgeLiveMessage}
      </span>
      {bridges.childBridges.map(bridge => (
        <span key={bridge.username || bridge.name} className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {bridges.childBridgeLiveMessages[bridge.username || bridge.name]}
        </span>
      ))}
      <div className={cx('drag-handler p-2', widget.draggable && 'widget-cursor')}>
        {t('child_bridge.bridges')}
      </div>
      <div className="d-flex flex-wrap w-100 mt-0 justify-content-start gridster-item-content overflow-auto no-scrollbars align-items-center">
        <button
          type="button"
          className="hb-status-item hb-status-item-quarter hb-status-row d-flex flex-row w-100 px-3 mt-2 mb-1 text-start"
          aria-label={bridges.mainBridgeAriaLabel()}
          aria-disabled={mainBusy || !isAdmin ? 'true' : undefined}
          onClick={() => {
            if (!(mainBusy || !isAdmin)) {
              void bridges.restartHomebridge()
            }
          }}
        >
          <div className="hb-status-icon d-flex align-items-center">
            {/* Same shared icons as the child rows - the main bridge is mapped
                into the same source shape so the colour/tooltip rules have one owner */}
            <ChildBridgeStatusIcons bridge={bridges.mainBridgeIconSource()} serverRestarting={bridges.isRestarting} />
          </div>
          <div className="align-self-center flex-child px-2">{status?.name || 'Homebridge'}</div>
          <div className="grey-text ms-auto d-flex align-items-center" aria-hidden="true">
            {!mainBusy && isAdmin && <i className="fas fa-power-off"></i>}
            {mainBusy && <i className="fas fa-circle-notch fa-spin"></i>}
          </div>
        </button>
        {bridges.childBridges.map((bridge) => {
          const busy = bridge.status === 'pending' || !!bridge.restarting || bridges.isRestarting
          return (
            <button
              key={bridge.username || bridge.name}
              type="button"
              className="hb-status-item hb-status-item-quarter hb-status-row d-flex flex-row w-100 px-3 mt-2 mb-1 text-start"
              aria-label={bridges.childBridgeAriaLabel(bridge)}
              aria-disabled={busy || !isAdmin ? 'true' : undefined}
              onClick={() => {
                if (!(busy || !isAdmin)) {
                  void bridges.restartChildBridge(bridge)
                }
              }}
            >
              <div className="hb-status-icon d-flex align-items-center">
                <ChildBridgeStatusIcons bridge={bridge} serverRestarting={bridges.isRestarting} />
              </div>
              <div className="align-self-center flex-child px-2">{bridge.name}</div>
              <div className="grey-text ms-auto d-flex align-items-center" aria-hidden="true">
                {!busy && isAdmin && <i className="fas fa-power-off"></i>}
                {busy && <i className="fas fa-circle-notch fa-spin"></i>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
