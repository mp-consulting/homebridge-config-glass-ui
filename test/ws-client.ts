import { vi } from 'vitest'

/**
 * Give a fake socket the state a WS guard leaves on a real one: the verified
 * user, and the re-check that raw listeners (terminal stdin, custom plugin UI
 * requests, accessory control) run before acting.
 *
 * `revalidateUser` is a mock, so a test can revoke the user part-way through:
 * `client.data.revalidateUser.mockRejectedValue(new Error('revoked'))`.
 */
export function authorizeWsClient<T extends object>(client: T, user = { username: 'admin', admin: true }): T & { data: any, disconnect: any } {
  const socket = client as T & { data: any, disconnect: any }
  socket.data = { user, verifiedAt: Date.now(), revalidateUser: vi.fn(async () => user) }
  socket.disconnect ??= vi.fn()
  return socket
}
