import { isIP } from 'node:net'

/** proxy-addr's names for address ranges */
const TRUST_PROXY_KEYWORDS = ['loopback', 'linklocal', 'uniquelocal']

/**
 * Parse `ui.trustProxy`: the reverse proxies whose `X-Forwarded-For` the UI
 * believes, so that the client address (used to throttle logins per source)
 * is the real client's rather than the proxy's. Opt-in, and only a list of
 * addresses / CIDR ranges (or proxy-addr's `loopback`, `linklocal`,
 * `uniquelocal`) - never `true`: trusting the header from anyone would let any
 * client pick its own address and step around the per-source login limit.
 *
 * Takes an array or a comma/space separated string. Returns undefined (proxy
 * headers ignored, the default) when unset, and reports an invalid value
 * through `onInvalid` and ignores it as a whole rather than half-applying it -
 * a value that made the server fail to start would lock everyone out of the UI.
 */
export function parseTrustProxy(value: unknown, onInvalid: (reason: string) => void = () => {}): string[] | undefined {
  if (value === undefined || value === null || value === '' || value === false) {
    return undefined
  }
  if (typeof value !== 'string' && !Array.isArray(value)) {
    onInvalid('ui.trustProxy must be a list of proxy addresses or CIDR ranges (e.g. ["127.0.0.1", "10.0.0.0/8"]).')
    return undefined
  }
  const entries = (Array.isArray(value) ? value : value.split(/[\s,]+/))
    .map(entry => typeof entry === 'string' ? entry.trim() : entry)
    .filter(entry => entry !== '')
  const invalid = entries.filter(entry => !isTrustProxyEntry(entry))
  if (invalid.length) {
    onInvalid(`ui.trustProxy has entries that are not an address, CIDR range or one of ${TRUST_PROXY_KEYWORDS.join(', ')}: ${invalid.map(x => JSON.stringify(x)).join(', ')}.`)
    return undefined
  }
  return entries.length ? entries as string[] : undefined
}

function isTrustProxyEntry(entry: unknown): boolean {
  if (typeof entry !== 'string') {
    return false
  }
  if (TRUST_PROXY_KEYWORDS.includes(entry)) {
    return true
  }
  const [address, prefix, ...rest] = entry.split('/')
  const family = isIP(address)
  // No zone ids (fe80::1%en0): proxy-addr cannot parse them
  if (!family || rest.length || address.includes('%')) {
    return false
  }
  if (prefix === undefined) {
    return true
  }
  // A dotted netmask (10.0.0.0/255.0.0.0) is accepted by proxy-addr for IPv4
  if (family === 4 && isIP(prefix) === 4) {
    return true
  }
  if (!/^\d{1,3}$/.test(prefix)) {
    return false
  }
  return Number(prefix) <= (family === 4 ? 32 : 128)
}
