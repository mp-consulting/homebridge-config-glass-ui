import type { AccessoryConfig, HomebridgeConfig, PlatformConfig } from '../../core/config/config.interfaces.js'

import { Buffer } from 'node:buffer'

import { RE_CHAR_PAIRS, RE_HYPHEN_GLOBAL } from '../../core/regex.constants.js'

/** The subset of a HAP-NodeJS `AccessoryInfo.<id>.json` file needed to build a setup code. */
export interface SetupCodeAccessoryInfo {
  pincode: string
  category: number
  setupID: string
}

/** A device pairing (HAP bridge / external accessory, or Matter-only external accessory). */
export interface DevicePairing {
  _id: string
  name: string
  [key: string]: unknown
}

/** A HAP-NodeJS `AccessoryInfo.<id>.json` file, plus the `_`-prefixed fields the UI adds. */
export interface HapAccessoryInfo extends SetupCodeAccessoryInfo, DevicePairing {
  displayName?: string
  pairedClients?: Record<string, unknown>
}

/** Plugin attribution of an external accessory, from the homebridge `externalAccessories` index files. */
export interface ExternalAccessoryAttribution {
  plugin: string
  displayName?: string
  category?: number
  port?: number
}

/** A config block that can own a bridge: a child bridge plugin block, or the main bridge. */
export type BridgeOwnerBlock = AccessoryConfig | PlatformConfig | { _bridge: HomebridgeConfig['bridge'], name?: undefined }

/** Convert a MAC address to a hex string: `'0E:3C:22:18:EC:79'` → `'0E3C2218EC79'` */
export function macToHex(mac: string): string {
  return mac.split(':').join('').toUpperCase()
}

/** Convert a hex string to MAC address format: `'0E3C2218EC79'` → `'0E:3C:22:18:EC:79'` */
export function hexToMac(hex: string): string {
  return hex.match(RE_CHAR_PAIRS)?.join(':').toUpperCase() || hex.toUpperCase()
}

/**
 * Generates the setup code
 */
export function generateSetupCode(accessoryInfo: SetupCodeAccessoryInfo): string {
  const buffer = Buffer.allocUnsafe(8)
  let valueLow = Number.parseInt(accessoryInfo.pincode.replace(RE_HYPHEN_GLOBAL, ''), 10)
  const valueHigh = accessoryInfo.category >> 1

  valueLow |= 1 << 28 // Supports IP;

  buffer.writeUInt32BE(valueLow, 4)

  if (accessoryInfo.category & 1) {
    buffer[4] = buffer[4] | 1 << 7
  }

  buffer.writeUInt32BE(valueHigh, 0)

  let encodedPayload = (buffer.readUInt32BE(4) + (buffer.readUInt32BE(0) * 2 ** 32)).toString(36).toUpperCase()

  if (encodedPayload.length !== 9) {
    for (let i = 0; i <= 9 - encodedPayload.length; i += 1) {
      encodedPayload = `0${encodedPayload}`
    }
  }

  return `X-HM://${encodedPayload}${accessoryInfo.setupID}`
}
