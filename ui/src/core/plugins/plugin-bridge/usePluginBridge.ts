import type { ActiveModal } from '@/core/ui/modal'
import type { PluginBridgeModalData } from '@/core/ui/modal-data'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'

import { PluginBridgeController } from '@/core/plugins/plugin-bridge/plugin-bridge.controller'

/**
 * The modal's controller, created once per modal, and a re-render whenever its
 * state changes.
 */
export function usePluginBridge(data: PluginBridgeModalData, activeModal: ActiveModal): PluginBridgeController {
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  const [ctrl] = useState(() => new PluginBridgeController(data, {
    activeModal,
    navigate: path => navigateRef.current(path),
  }))

  useSyncExternalStore(ctrl.subscribe, ctrl.getVersion, ctrl.getVersion)

  useEffect(() => {
    void ctrl.init()
  }, [ctrl])

  return ctrl
}
