// React keys for layout nodes. Angular tracks `@for` items by object identity
// (`track layoutItem`), so a node keeps its component (and state) when the
// array around it changes; a WeakMap id gives React the same behaviour.
const ids = new WeakMap<object, number>()
let nextId = 0

export function layoutKey(node: unknown): string | number {
  if (node === null || typeof node !== 'object') {
    return `v:${String(node)}`
  }
  let id = ids.get(node)
  if (id === undefined) {
    id = nextId++
    ids.set(node, id)
  }
  return id
}
