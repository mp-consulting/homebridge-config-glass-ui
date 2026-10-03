/**
 * A byte count in megabytes, one decimal: `1572864` → `1.5MB` (the file sizes
 * the backup and upload toasts show).
 * @param bytes - the size in bytes
 */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
