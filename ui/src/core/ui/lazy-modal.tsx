import type { ComponentType } from 'react'

import { createElement, useEffect, useState } from 'react'

interface DismissibleProps {
  activeModal?: { dismiss: (reason?: unknown) => void }
}

export type LazyModal<P> = ComponentType<P> & {
  /** Start loading the real component; resolves to it. */
  preload: () => Promise<ComponentType<P>>
}

/**
 * A modal component whose code is loaded the first time it is opened, for
 * `openModal(LazyThing, props)`. Until the chunk arrives the modal renders
 * nothing (ng-bootstrap focuses the modal window, as it does for content
 * without an autofocus target); once it has loaded, later opens render at
 * once. A failed load dismisses the modal rather than leaving it empty.
 * @param load - imports the module and picks the component out of it
 */
export function lazyModal<P extends object>(load: () => Promise<ComponentType<P>>): LazyModal<P> {
  let loaded: ComponentType<P> | undefined
  let pending: Promise<ComponentType<P>> | undefined

  const preload = (): Promise<ComponentType<P>> => {
    pending ??= load().then((component) => {
      loaded = component
      return component
    }, (error: unknown) => {
      // A later open tries again (e.g. after a flaky network)
      pending = undefined
      throw error
    })
    return pending
  }

  function LazyModalComponent(props: P) {
    const [component, setComponent] = useState<ComponentType<P> | undefined>(() => loaded)

    useEffect(() => {
      if (component) {
        return undefined
      }
      let live = true
      preload().then((resolved) => {
        if (live) {
          setComponent(() => resolved)
        }
      }, (error: unknown) => {
        console.error(error)
        if (live) {
          (props as DismissibleProps).activeModal?.dismiss(error)
        }
      })
      return () => {
        live = false
      }
      // Loads once per mount; the props are passed through on every render
      // eslint-disable-next-line react/exhaustive-deps
    }, [component])

    return component ? createElement(component, props) : null
  }

  return Object.assign(LazyModalComponent, { preload })
}
