export interface SslConfig {
  mode: SslMode
  hostnames: string
  keyPath: string
  certPath: string
  pfxPath: string
  passphrase: string
}

export interface PendingFiles {
  key: File | null
  cert: File | null
  pfx: File | null
}

export type SslMode = 'off' | 'selfsigned' | 'keycert' | 'pfx'

/**
 * Whether the save button has to stay off for the chosen mode.
 * @param config - what the form holds
 * @param pending - the files picked but not uploaded yet
 */
export function isSslFormInvalid(config: SslConfig, pending: PendingFiles): boolean {
  switch (config.mode) {
    case 'selfsigned': {
      // Hostnames field must not be empty
      return !config.hostnames.trim()
    }
    case 'keycert': {
      // Either both files are pending upload, or both paths are already saved
      const hasKey = !!pending.key || !!config.keyPath
      const hasCert = !!pending.cert || !!config.certPath
      return !hasKey || !hasCert
    }
    case 'pfx': {
      // PFX is either pending or already saved
      return !pending.pfx && !config.pfxPath
    }
    case 'off':
    default:
      return false
  }
}
