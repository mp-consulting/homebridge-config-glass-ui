import type { ReactNode } from 'react'

import { Component } from 'react'

/**
 * Keeps one broken widget from taking the whole form down. Angular's
 * ErrorHandler logged an exception thrown while rendering a formworks widget
 * and left the rest of the form working; React would unmount the whole tree.
 */
export class WidgetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error('ERROR', error)
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}
