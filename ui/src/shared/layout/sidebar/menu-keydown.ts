import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Activate a menu control with Enter or Space (the mobile header is a div with
 * role="button", which does neither by itself).
 * @param event - the keydown
 */
export function handleMenuKeydown(event: Pick<KeyboardEvent, 'key' | 'target'> & Partial<Pick<KeyboardEvent, 'preventDefault'>> | ReactKeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    const target = event.target as HTMLElement
    if (['menuitem', 'button'].includes(target.getAttribute('role')!)) {
      // Space would otherwise scroll the page
      event.preventDefault?.()
      target.click()
    }
  }
}
