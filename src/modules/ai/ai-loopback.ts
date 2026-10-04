import type { Buffer } from 'node:buffer'

import { X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rootCertificates } from 'node:tls'

import { Agent, fetch as undiciFetch } from 'undici'

/** What the Assistant's HomebridgeClient is given to reach this server. */
export type LoopbackFetch = typeof fetch

/**
 * Where this server's own certificate is: the self-signed one under
 * `<storage>/ssl-certs`, or the configured `ui.ssl.cert` file. Null for a
 * PFX bundle, which this does not unpack.
 * @param ssl - the `ssl` block of the UI config
 * @param storagePath - the Homebridge storage path
 */
export function uiCertificatePath(ssl: Record<string, unknown> | undefined, storagePath: string): string | null {
  if (ssl?.selfSigned) {
    return join(storagePath, 'ssl-certs', 'certificate.pem')
  }
  if (typeof ssl?.cert === 'string' && ssl.cert) {
    return ssl.cert
  }
  return null
}

/**
 * A fetch that trusts exactly this server's certificate, for the loopback
 * call from the Assistant's tools to `https://127.0.0.1:<port>`. Only this
 * fetch is affected: global fetch and every other connection keep Node's
 * normal verification.
 *
 * The chain must validate against the certificate itself (self-signed) or a
 * public root, and the leaf the server presents must be the configured one
 * (pinned by its SHA-256 fingerprint). The hostname is not compared, since the
 * call goes to 127.0.0.1 while the certificate names the host people browse to.
 * @param certificatePem - the PEM certificate (the first one, if it is a chain, is the leaf)
 */
export function createLoopbackFetch(certificatePem: Buffer | string): LoopbackFetch {
  const pem = certificatePem.toString()
  const expected = new X509Certificate(pem).fingerprint256
  const agent = new Agent({
    connect: {
      ca: [...rootCertificates, pem],
      checkServerIdentity: (_host, peer) => peer.fingerprint256 === expected
        ? undefined
        : new Error('The server at the loopback address did not present Glass UI\'s own certificate.'),
    },
  })
  const loopbackFetch = (input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
    undiciFetch(input, { ...init, dispatcher: agent })
  return loopbackFetch as unknown as LoopbackFetch
}

/**
 * A fetch that always fails with `message`, shaped like a network failure
 * (`TypeError('fetch failed')` with the reason as its cause), so the client
 * reports it as why the server cannot be reached.
 */
export function failingFetch(message: string): LoopbackFetch {
  return (async () => {
    throw new TypeError('fetch failed', { cause: new Error(message) })
  }) as LoopbackFetch
}

/**
 * The loopback fetch for this server's HTTPS, or a failing one that says why
 * the certificate could not be used.
 * @param ssl - the `ssl` block of the UI config
 * @param storagePath - the Homebridge storage path
 */
export async function loadLoopbackFetch(ssl: Record<string, unknown> | undefined, storagePath: string): Promise<{ fetch: LoopbackFetch, error?: string }> {
  const path = uiCertificatePath(ssl, storagePath)
  if (!path) {
    const error = 'The Assistant\'s tools cannot verify Glass UI\'s HTTPS certificate: a PFX certificate is configured. Set UIX_AI_LOCAL_URL to an address whose certificate Node trusts.'
    return { fetch: failingFetch(error), error }
  }
  try {
    return { fetch: createLoopbackFetch(await readFile(path)) }
  } catch (e) {
    const error = `The Assistant's tools cannot verify Glass UI's HTTPS certificate: ${(e as Error).message}. Set UIX_AI_LOCAL_URL to an address whose certificate Node trusts.`
    return { fetch: failingFetch(error), error }
  }
}
