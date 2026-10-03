/**
 * Join class names: the React form of Angular's static `class` plus `[class]`
 * and `[class.name]="cond"` bindings. Falsy fragments are dropped, an object
 * contributes the keys whose value is truthy, and duplicate names collapse.
 * Returns `undefined` when nothing is left, so React omits the attribute.
 *
 *     cx('btn', active && 'active', { disabled: busy })
 */
export function cx(...parts: Array<string | false | null | undefined | 0 | Record<string, unknown>>): string | undefined {
  const names: string[] = []
  for (const part of parts) {
    if (!part) {
      continue
    }
    if (typeof part === 'string') {
      for (const name of part.split(/\s+/)) {
        if (name && !names.includes(name)) {
          names.push(name)
        }
      }
    } else {
      for (const [name, on] of Object.entries(part)) {
        if (on && !names.includes(name)) {
          names.push(name)
        }
      }
    }
  }
  return names.length ? names.join(' ') : undefined
}
