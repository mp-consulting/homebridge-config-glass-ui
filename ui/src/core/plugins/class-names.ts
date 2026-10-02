/** Join the truthy class names: the React form of `[class.x]="cond"` bindings. */
export function cls(...names: (string | false | null | undefined | 0)[]): string {
  return names.filter(Boolean).join(' ')
}
