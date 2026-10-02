import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Activate a menu control with Enter (the mobile header is a div with
 * role="button", which does not do that by itself).
 * @param event - the keydown
 */
export function handleMenuKeydown(event: Pick<KeyboardEvent, 'key' | 'target'> | ReactKeyboardEvent): void {
  if (event.key === 'Enter') {
    const target = event.target as HTMLElement
    if (['menuitem', 'button'].includes(target.getAttribute('role')!)) {
      target.click()
    }
  }
}
