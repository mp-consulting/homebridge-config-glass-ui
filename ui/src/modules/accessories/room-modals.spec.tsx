import type { Mock } from 'vitest'

import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AddRoom } from '@/modules/accessories/add-room/AddRoom'
import { EditRoom } from '@/modules/accessories/edit-room/EditRoom'
import { deleteTargets } from '@/modules/accessories/room-name'
import { renderWithProviders } from '@/testing'

/**
 * Adding and renaming the rooms on the accessories page.
 *
 * Rooms are a UI-only grouping - Homebridge knows nothing about them - so the
 * rules are all about keeping the list coherent. Exactly one room is the default,
 * which is where a newly discovered accessory lands, so the default cannot be
 * un-set and the last remaining room cannot stop being it. Deleting a room has to
 * say where its accessories are going, because they are not deleted with it.
 */
describe('the room modals', () => {
  let activeModal: { close: Mock<(value?: any) => void>, dismiss: Mock<(reason?: unknown) => void>, update: Mock<() => void> }

  function openAdd(existingRooms: Array<{ name: string, isDefault?: boolean }>) {
    activeModal = { close: vi.fn<(value?: any) => void>(), dismiss: vi.fn<(reason?: unknown) => void>(), update: vi.fn<() => void>() }
    return renderWithProviders(<AddRoom activeModal={activeModal} existingRooms={existingRooms} />)
  }

  function openEdit(existingRooms: Array<{ name: string, isDefault?: boolean }>, currentRoomIndex: number) {
    activeModal = { close: vi.fn<(value?: any) => void>(), dismiss: vi.fn<(reason?: unknown) => void>(), update: vi.fn<() => void>() }
    const room = existingRooms[currentRoomIndex]
    return renderWithProviders(
      <EditRoom
        activeModal={activeModal}
        roomName={room.name}
        isDefault={!!room.isDefault}
        existingRooms={existingRooms}
        currentRoomIndex={currentRoomIndex}
      />,
    )
  }

  const nameInput = () => document.querySelector('#form-name') as HTMLInputElement
  const defaultBox = () => document.querySelector('#form-default') as HTMLInputElement
  const submit = () => document.querySelector('button[type="submit"]') as HTMLButtonElement
  const deleteToggle = () => screen.getByRole('button', { name: 'accessories.button_delete_room' })

  function type(value: string) {
    fireEvent.change(nameInput(), { target: { value } })
  }

  /** Submit the form (what Enter, or the save button, does). */
  function save() {
    fireEvent.submit(nameInput().form!)
  }

  const threeRooms = [
    { name: 'Default Room', isDefault: true },
    { name: 'Kitchen' },
    { name: 'Hall' },
  ]

  describe('adding a room', () => {
    it('needs a name', () => {
      openAdd(threeRooms)
      expect(submit()).toBeDisabled()

      type('Bedroom')
      expect(submit()).toBeEnabled()
    })

    it('closes with the name and the default flag', () => {
      openAdd(threeRooms)
      type('Bedroom')
      fireEvent.click(defaultBox())
      save()

      expect(activeModal.close).toHaveBeenCalledWith({ name: 'Bedroom', isDefault: true })
    })

    it('trims the name the user typed', () => {
      // The name is what appears as a heading, and a padded one is impossible to
      // spot as the reason two rooms look identical
      openAdd(threeRooms)
      type('  Bedroom  ')
      save()

      expect(activeModal.close).toHaveBeenCalledWith({ name: 'Bedroom', isDefault: false })
    })

    it('refuses a name another room already has', () => {
      openAdd(threeRooms)
      type('Kitchen')

      expect(submit()).toBeDisabled()
    })

    it('ignores case and padding when comparing names', () => {
      // Two rooms called Kitchen and kitchen are indistinguishable on the page
      openAdd(threeRooms)
      type('  kITCHEN ')

      expect(submit()).toBeDisabled()
    })

    it('marks the name invalid only once the field was left', () => {
      openAdd(threeRooms)
      type('Kitchen')
      expect(nameInput()).not.toHaveClass('is-invalid')

      fireEvent.blur(nameInput())
      expect(nameInput()).toHaveClass('is-invalid')
    })

    it('will not create a room named only spaces', () => {
      // `Validators.required` used to accept a value of spaces alone, and the
      // trim then created a room with no name at all
      openAdd(threeRooms)
      type('   ')
      save()

      expect(submit()).toBeDisabled()
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('still accepts a name with spaces around it', () => {
      openAdd(threeRooms)
      type('  Utility Room  ')
      save()

      expect(activeModal.close).toHaveBeenCalledWith({ name: 'Utility Room', isDefault: false })
    })

    it('accepts a name of a single character', () => {
      // The rule is "not blank", not "long enough"
      openAdd(threeRooms)
      type('X')

      expect(submit()).toBeEnabled()
    })

    it('will not close while the name is unusable', () => {
      openAdd(threeRooms)
      type('Kitchen')
      save()

      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('makes the very first room the default, ticked but untouchable', () => {
      // Something has to be the default, and there is nothing else to be it
      openAdd([])

      expect(defaultBox().checked).toBe(true)
      expect(defaultBox()).toBeDisabled()
    })

    it('still submits the very first room as the default', () => {
      openAdd([])
      type('Lounge')
      save()

      expect(activeModal.close).toHaveBeenCalledWith({ name: 'Lounge', isDefault: true })
    })

    it('does not force the default when rooms already exist', () => {
      openAdd(threeRooms)

      expect(defaultBox().checked).toBe(false)
      expect(defaultBox()).toBeEnabled()
    })

    it('saves on Enter in the default checkbox', () => {
      openAdd(threeRooms)
      type('Bedroom')
      fireEvent.keyUp(defaultBox(), { key: 'Enter' })

      expect(activeModal.close).toHaveBeenCalledWith({ name: 'Bedroom', isDefault: false })
    })

    it('dismisses on close', () => {
      openAdd(threeRooms)
      fireEvent.click(screen.getByRole('button', { name: 'form.button_close' }))

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })
  })

  describe('renaming a room', () => {
    it('starts from the room as it is', () => {
      openEdit(threeRooms, 1)

      expect(nameInput().value).toBe('Kitchen')
      expect(defaultBox().checked).toBe(false)
      // Nothing changed yet, so nothing to save
      expect(submit()).toBeDisabled()
    })

    it('notices the name being changed', () => {
      openEdit(threeRooms, 1)
      type('Kitchenette')

      expect(submit()).toBeEnabled()
    })

    it('says nothing changed again once a change is undone', () => {
      openEdit(threeRooms, 1)
      type('Kitchenette')
      type('Kitchen')

      expect(submit()).toBeDisabled()
    })

    it('does not count its own name as a duplicate', () => {
      // The room being edited is skipped by index
      openEdit(threeRooms, 1)
      fireEvent.click(defaultBox())

      expect(submit()).toBeEnabled()
    })

    it('still refuses the name of another room', () => {
      openEdit(threeRooms, 1)
      type('Hall')

      expect(submit()).toBeDisabled()
    })

    it('closes with the new name and the default flag', () => {
      openEdit(threeRooms, 1)
      type('Kitchenette')
      fireEvent.click(defaultBox())
      save()

      expect(activeModal.close).toHaveBeenCalledWith({ name: 'Kitchenette', isDefault: true })
    })

    it('will not close on an invalid name', () => {
      openEdit(threeRooms, 1)
      type('')
      save()

      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('will not rename a room to nothing but spaces', () => {
      openEdit(threeRooms, 1)
      type('   ')
      save()

      expect(activeModal.close).not.toHaveBeenCalled()
    })
  })

  describe('which room is the default', () => {
    it('will not let the default room stop being the default', () => {
      // Exactly one room has to be the default, and un-ticking this leaves none
      openEdit(threeRooms, 0)

      expect(defaultBox()).toBeDisabled()
    })

    it('will not let the only room stop being the default', () => {
      openEdit([{ name: 'Default Room', isDefault: true }], 0)

      expect(defaultBox()).toBeDisabled()
      // Nor can it be deleted
      expect(deleteToggle()).toBeDisabled()
    })

    it('lets an ordinary room be promoted', () => {
      openEdit(threeRooms, 1)

      expect(defaultBox()).toBeEnabled()
    })

    it('includes the locked default flag when closing', () => {
      openEdit(threeRooms, 0)
      type('Renamed Default')
      save()

      expect(activeModal.close).toHaveBeenCalledWith({ name: 'Renamed Default', isDefault: true })
    })
  })

  describe('deleting a room', () => {
    it('says where the accessories will go', () => {
      // They are moved to the default room, not deleted with it
      expect(deleteTargets(threeRooms, 1, false).targetRoomName).toBe('Default Room')
    })

    it('moves them to the first other room when deleting the default', () => {
      // There is no default to move them to, so the room that is about to
      // become the default takes them
      expect(deleteTargets(threeRooms, 0, true)).toEqual({ targetRoomName: 'Kitchen', newDefaultRoomName: 'Kitchen' })
    })

    it('names no new default when an ordinary room is deleted', () => {
      expect(deleteTargets(threeRooms, 1, false).newDefaultRoomName).toBe('')
    })

    it('falls back to the first room when nothing is marked default', () => {
      // An older saved layout may have no default at all
      expect(deleteTargets([{ name: 'Kitchen' }, { name: 'Hall' }], 1, false).targetRoomName).toBe('Kitchen')
    })

    it('shows where the accessories go while confirming', () => {
      openEdit(threeRooms, 0)
      fireEvent.click(deleteToggle())

      expect(screen.getByText('accessories.delete_room_move_accessories')).toBeInTheDocument()
      expect(screen.getByText('accessories.delete_room_new_default')).toBeInTheDocument()
    })

    it('locks the form while the delete is being confirmed', () => {
      // The name boxes are still on screen, and editing them while confirming a
      // delete would be meaningless
      openEdit(threeRooms, 1)
      fireEvent.click(deleteToggle())

      expect(nameInput()).toBeDisabled()
      expect(defaultBox()).toBeDisabled()
      expect(submit()).toHaveClass('btn-danger')
    })

    it('closes with a delete instruction rather than a room', () => {
      openEdit(threeRooms, 1)
      fireEvent.click(deleteToggle())
      save()

      expect(activeModal.close).toHaveBeenCalledWith({ delete: true })
    })

    it('deletes even when the name was left invalid', () => {
      // The name is about to stop existing, so refusing to delete over it would
      // trap the user
      openEdit(threeRooms, 1)
      type('')
      fireEvent.click(deleteToggle())

      expect(submit()).toBeEnabled()
      save()
      expect(activeModal.close).toHaveBeenCalledWith({ delete: true })
    })

    it('re-enables the form when the delete is called off', () => {
      openEdit(threeRooms, 1)
      fireEvent.click(deleteToggle())
      fireEvent.click(deleteToggle())

      expect(nameInput()).toBeEnabled()
      expect(submit()).toHaveClass('btn-primary')
    })

    it('keeps the default flag locked after backing out', () => {
      // Re-enabling the whole form would quietly hand back a checkbox that must
      // stay locked
      openEdit(threeRooms, 0)
      fireEvent.click(deleteToggle())
      fireEvent.click(deleteToggle())

      expect(defaultBox()).toBeDisabled()
      expect(nameInput()).toBeEnabled()
    })
  })
})
