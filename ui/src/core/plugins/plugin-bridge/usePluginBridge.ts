import type { ActiveModal } from '@/core/ui/modal'
import type { PluginBridgeModalData } from '@/core/ui/modal-data'

import type { PluginBridgeStore } from './plugin-bridge.state'

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { createPluginBridgeStore } from './plugin-bridge.store'

/** The modal's store, created once per mounted editor, and loaded on mount. */
export function usePluginBridge(data: PluginBridgeModalData, activeModal: ActiveModal): PluginBridgeStore {
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  const [store] = useState(() => createPluginBridgeStore(data, {
    activeModal,
    navigate: path => navigateRef.current(path),
  }))

  useEffect(() => {
    void store.getState().init()
  }, [store])

  return store
}
