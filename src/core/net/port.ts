/* global NodeJS */
import { randomInt } from 'node:crypto'
import { Socket } from 'node:net'

/**
 * Whether something accepts TCP connections on `host:port`. Connects rather
 * than binding: a connection means in use, ECONNREFUSED means free, and any
 * other error (e.g. an unreachable host) rejects.
 *
 * The probe's own local port can be the very port it probes. Linux then
 * connects the socket to itself (TCP simultaneous open) and macOS fails the
 * connect with EINVAL. Neither means a listener: the system never hands out a
 * port something has bound as a local port, so both count as free.
 */
export function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(new Error(`invalid port: ${String(port)}`))
  }

  return new Promise((resolve, reject) => {
    const socket = new Socket()
    const done = () => {
      socket.removeAllListeners('connect')
      socket.removeAllListeners('error')
      socket.destroy()
      socket.unref()
    }
    socket.once('connect', () => {
      const selfConnected = socket.localPort === socket.remotePort && socket.localAddress === socket.remoteAddress
      done()
      resolve(!selfConnected)
    })
    socket.once('error', (err: NodeJS.ErrnoException) => {
      done()
      if (err.code === 'ECONNREFUSED' || err.code === 'EINVAL') {
        resolve(false)
      } else {
        reject(err)
      }
    })
    socket.connect({ port, host })
  })
}

/**
 * Picks random ports in `min`-`max` (inclusive) until one is not in use.
 * There is no attempt limit, so the range must contain a free port.
 */
export async function findFreePort(min: number, max: number, host?: string): Promise<number> {
  const randomPort = () => randomInt(min, max + 1)

  let port = randomPort()
  while (await isPortInUse(port, host)) {
    port = randomPort()
  }
  return port
}
