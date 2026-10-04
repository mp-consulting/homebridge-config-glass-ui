import type { AiOrganizationSuggestion } from '@/core/ai/ai.interfaces'

/** One accessory as the organiser sees it. */
export interface OrganizerAccessory {
  uniqueId: string
  name: string
  type?: string
  manufacturer?: string
  model?: string
  room: string
}

export interface OrganizerChanges {
  moves: Array<{ uniqueId: string, room: string }>
  renames: Array<{ uniqueId: string, name: string }>
}

/** One suggested change the user can keep or drop. */
export interface OrganizerItem {
  key: string
  uniqueId: string
  kind: 'move' | 'rename'
  value: string
  from: string
  reason?: string
}

/** Turn the suggestion into reviewable items, leaving out ones that change nothing. */
export function suggestionItems(suggestion: AiOrganizationSuggestion, accessories: OrganizerAccessory[]): OrganizerItem[] {
  const byId = new Map(accessories.map(a => [a.uniqueId, a]))
  const items: OrganizerItem[] = []
  for (const room of suggestion.rooms) {
    for (const uniqueId of room.accessories) {
      const accessory = byId.get(uniqueId)
      if (accessory && accessory.room !== room.name && !items.some(i => i.kind === 'move' && i.uniqueId === uniqueId)) {
        items.push({ key: `move:${uniqueId}`, uniqueId, kind: 'move', value: room.name, from: accessory.room })
      }
    }
  }
  for (const rename of suggestion.renames) {
    const accessory = byId.get(rename.uniqueId)
    if (accessory && rename.name.trim() && accessory.name !== rename.name) {
      items.push({ key: `rename:${rename.uniqueId}`, uniqueId: rename.uniqueId, kind: 'rename', value: rename.name.trim(), from: accessory.name, reason: rename.reason })
    }
  }
  return items
}
