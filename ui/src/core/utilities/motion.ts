/**
 * Whether the user asked the system for less motion. Read at the moment of
 * use, so a change in the system settings applies to the next animation.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
}
