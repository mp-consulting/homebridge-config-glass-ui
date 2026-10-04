import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

/** The favourite accessories: the ones marked "show on dashboard", not hidden, by room. */
export function favouritesOf(rooms: Array<{ name: string, services: ServiceTypeX[] }>): Array<{ name: string, services: ServiceTypeX[] }> {
  return rooms
    .map(room => ({ name: room.name, services: room.services.filter(service => service.onDashboard && !service.hidden) }))
    .filter(room => room.services.length > 0)
}
