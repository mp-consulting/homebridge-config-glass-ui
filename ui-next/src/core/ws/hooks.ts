import type { IoNamespace, OwnedIoNamespace, WsService } from './ws'

import { useEffect, useRef, useState } from 'react'

import { ws as defaultWs } from './ws'

/**
 * Hold a namespace for the life of the component: connects on mount and
 * `end()`s exactly this handle on unmount (or when `namespace` changes).
 *
 * Returns null on the first render, before the effect has run; listen for
 * `connected` (or use `useSocketEvent`) once it is there.
 * @param namespace - e.g. `status`; null/undefined holds nothing
 * @param service - the WsService to use (the app's one by default)
 */
export function useNamespace(namespace: string | null | undefined, service: WsService = defaultWs): OwnedIoNamespace | null {
  const [io, setIo] = useState<OwnedIoNamespace | null>(null)

  useEffect(() => {
    if (!namespace) {
      return undefined
    }
    // The handle is an external resource taken here and released in the
    // cleanup, so the state is set from the effect on purpose: taking it during
    // render would leak a reference on every discarded render
    const handle = service.connectToNamespace(namespace)
    // eslint-disable-next-line react/set-state-in-effect
    setIo(handle)
    return () => {
      handle.end()
      setIo(current => (current === handle ? null : current))
    }
  }, [namespace, service])

  return namespace ? io : null
}

/**
 * Listen for one socket event while the component is mounted. The listener is
 * removed with `off(event, listener)` on unmount, or when the namespace or event
 * changes — consumers no longer have to remember to `off` by hand. The latest
 * `handler` is always called, so it does not need to be memoised.
 * @param io - the namespace (null while it is not there yet)
 * @param event - the event name
 * @param handler - called with the event's arguments
 */
export function useSocketEvent<A extends any[] = any[]>(io: IoNamespace | null | undefined, event: string, handler: (...args: A) => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  const socket = io?.socket

  useEffect(() => {
    if (!socket) {
      return undefined
    }
    const listener = (...args: any[]) => handlerRef.current(...(args as A))
    socket.on(event, listener)
    return () => {
      socket.off(event, listener)
    }
  }, [socket, event])
}

/**
 * Run `handler` each time the namespace (re)connects - including straight
 * away when it already is, since `connected` replays. Unsubscribes on unmount.
 * @param io - the namespace (null while it is not there yet)
 * @param handler - called on every connect
 */
export function useNamespaceConnected(io: IoNamespace | null | undefined, handler: () => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  const connected = io?.connected

  useEffect(() => {
    if (!connected) {
      return undefined
    }
    return connected.subscribe(() => handlerRef.current())
  }, [connected])
}
