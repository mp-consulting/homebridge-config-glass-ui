/** The props the room modals are opened with (Angular's ADD_ROOM / EDIT_ROOM modal data tokens). */
export interface AddRoomModalData {
  existingRooms: Array<{ name: string, isDefault?: boolean }>
}

export interface EditRoomModalData {
  roomName: string
  isDefault: boolean
  existingRooms: Array<{ name: string, isDefault?: boolean }>
  currentRoomIndex: number
}

/** What the add-room modal closes with. */
export interface AddRoomResult {
  name: string
  isDefault: boolean
}

/** What the edit-room modal closes with: the edited room, or a delete. */
export interface EditRoomResult {
  name?: string
  isDefault?: boolean
  delete?: boolean
}
