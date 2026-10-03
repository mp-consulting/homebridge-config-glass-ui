/**
 * Whether a navigation failed because a lazy chunk could not be fetched.
 * @param error - what the route threw
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const err = error as { name?: string, message?: string }
  return err.name === 'ChunkLoadError'
    || /Loading chunk/i.test(err.message ?? '')
    || /Failed to fetch dynamically imported module/i.test(err.message ?? '')
    || /error loading dynamically imported module/i.test(err.message ?? '')
    || /Importing a module script failed/i.test(err.message ?? '')
}
