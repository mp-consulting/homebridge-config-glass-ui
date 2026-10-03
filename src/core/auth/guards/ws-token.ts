/**
 * Pull the JWT off a Socket.IO handshake.
 *
 * Clients send it in the `auth` payload, which travels in the handshake body
 * rather than the URL. A token in the query string is deliberately ignored:
 * query strings are recorded by reverse proxies, access logs and monitoring,
 * so anything captured there would stay a usable bearer credential until it
 * expires.
 */
export function extractWsToken(handshake: any): string | undefined {
  return handshake?.auth?.token
}
