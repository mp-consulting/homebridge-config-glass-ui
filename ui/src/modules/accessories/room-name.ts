import { RE_NOT_BLANK } from '@/core/regex.constants'

/**
 * Whether a room name is acceptable: present, not blank, and not the name of
 * another room (ignoring case and surrounding spaces).
 * @param value - the typed name
 * @param existingRooms - the rooms on the page
 * @param ignoreIndex - the room being edited, which may keep its own name
 */
export function isRoomNameValid(value: string, existingRooms: Array<{ name: string }>, ignoreIndex = -1): boolean {
  if (!value || !RE_NOT_BLANK.test(value)) {
    return false
  }
  const trimmedName = value.trim().toLowerCase()
  return !existingRooms.some((room, index) => index !== ignoreIndex && room.name.trim().toLowerCase() === trimmedName)
}

/**
 * Where a deleted room's accessories go: the first other room when the
 * default room is deleted (it becomes the new default), else the default room.
 */
export function deleteTargets(existingRooms: Array<{ name: string, isDefault?: boolean }>, currentRoomIndex: number, isDefault: boolean) {
  const otherRooms = existingRooms.filter((_, index) => index !== currentRoomIndex)
  const targetRoomName = isDefault
    ? otherRooms[0]?.name || ''
    : existingRooms.find(r => r.isDefault)?.name || existingRooms[0]?.name || ''
  // Only relevant if current room is default
  const newDefaultRoomName = isDefault ? otherRooms[0]?.name || '' : ''
  return { targetRoomName, newDefaultRoomName }
}
