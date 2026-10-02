export interface UserInterface {
  username?: string
  name?: string
  admin?: boolean
  instanceId?: string
  otpLegacySecret?: boolean
}

export interface TokenCacheEntry {
  token: string | null
  timestamp: number
}
