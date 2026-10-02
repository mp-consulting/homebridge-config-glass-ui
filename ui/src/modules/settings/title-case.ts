/**
 * Angular's `titlecase` pipe: the first letter of every word upper case, the
 * rest lower case.
 * @param value - the text
 */
export function titleCase(value: string | null | undefined): string {
  return (value ?? '').replace(/[\p{L}\p{N}]\S*/gu, word => word[0].toUpperCase() + word.slice(1).toLowerCase())
}
