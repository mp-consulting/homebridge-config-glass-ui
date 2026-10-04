/** The models this read-only comparison builds (distinct from the editor's own diff). */
export const BACKUP_DIFF_ORIGINAL_URI = 'file:///backup-compare-original.json'
export const BACKUP_DIFF_MODIFIED_URI = 'file:///backup-compare-modified.json'

/** Pretty-prints the editor text the same way a backup is, so formatting alone never shows as a change. */
export function normaliseConfigText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 4)
  } catch {
    // Unparseable editor content is compared as typed
    return text
  }
}
