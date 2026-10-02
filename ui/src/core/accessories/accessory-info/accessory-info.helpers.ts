import type {
  CachedAccessoryWithServices,
  MatchedCachedAccessory,
  PairingInfo,
  ServiceTypeX,
} from '@/core/accessories/accessories.interfaces'

import { Enums } from '@homebridge/hap-client/hap-types'

// Groups of service types that can be changed from one to another
const HAP_CUSTOM_TYPE_LIST: Array<Array<ServiceTypeX['type']>> = [
  [
    'AirPurifier',
    'Switch',
    'Outlet',
    'Fan',
    'Lightbulb',
    'Heater',
    'Cooler',
    'Humidifier',
    'Dehumidifier',
    'Television',
    'Valve',
    'RobotVacuum',
    'WashingMachine',
  ],
  [
    'Switch',
    'Outlet',
    'LockMechanism',
  ],
  [
    'Switch',
    'Outlet',
    'GarageDoorOpener',
  ],
  [
    'Door',
    'Window',
    'WindowCovering',
  ],
  [
    'Switch',
    'Outlet',
    'Doorbell',
    'Speaker',
    'SmartSpeaker',
    'Microphone',
  ],
]

// Groups of service types that can be changed from one to another
const MATTER_CUSTOM_TYPE_LIST: Array<Array<ServiceTypeX['type']>> = [
  [
    'OnOffLight',
    'OnOffLightSwitch',
    'OnOffPlugInUnit',
    'RoboticVacuumCleaner',
  ],
  [
    'Door',
    'Window',
    'WindowCovering',
  ],
  [
    'Fan',
  ],
  [
    'Thermostat',
  ],
]

export interface InfoEntry {
  key: string
  value: string | number | undefined
}

/** What the modal works out when it opens (Angular's `ngOnInit`). */
export interface AccessoryInfoModel {
  isMatterAccessory: boolean
  customTypeList: Array<ServiceTypeX['type']>
  /** The type the dropdown starts on: the saved custom type, else the real one. */
  initialCustomType: ServiceTypeX['type'] | undefined
  accessoryInformation: InfoEntry[]
  clusterInfo: Array<{ name: string, attributes: Record<string, unknown> }>
  matchedCachedAccessory: MatchedCachedAccessory
  extraServices: ServiceTypeX[]
}

/**
 * Find the cached accessory (from disk) the service belongs to: through the
 * pairing of its bridge to the cache file, then by Name + Serial Number. Only
 * an unambiguous match counts.
 * @param service - the HAP service
 * @param pairingCache - the known pairings
 * @param accessoryCache - the cached accessories
 */
export function matchToCachedAccessory(
  service: ServiceTypeX,
  pairingCache: PairingInfo[],
  accessoryCache: CachedAccessoryWithServices[],
): MatchedCachedAccessory {
  // Start with the service bridge username and see if we have a pairing with this username
  const bridgeUsername = service.instance.username
  const pairing = pairingCache.find(entry => entry._username === bridgeUsername)

  if (pairing) {
    // Now to the accessory cache to grab a list of this bridge's cached accessories
    const cacheFile = pairing._main
      ? 'cachedAccessories'
      : `cachedAccessories.${pairing._id}`

    const pairingAccessories = accessoryCache.filter(accessory => accessory.$cacheFile === cacheFile)
    if (pairingAccessories.length) {
      const serviceInputName = service.accessoryInformation.Name
      const serviceInputSerialNumber = service.accessoryInformation['Serial Number']
      const matchingAccessories = pairingAccessories.filter((cachedAccessory) => {
        const accessoryInfoService = cachedAccessory.services.find(entry => entry.constructorName === 'AccessoryInformation')
        const charName = accessoryInfoService?.characteristics.find(char => char.displayName === 'Name')
        const charSerialNumber = accessoryInfoService?.characteristics.find(char => char.displayName === 'Serial Number')
        return charName?.value === serviceInputName && charSerialNumber?.value === serviceInputSerialNumber
      })
      if (matchingAccessories.length === 1) {
        return {
          ...matchingAccessories[0],
          bridge: pairing.name,
        }
      }
    }
  }

  return null
}

/**
 * Work out everything the modal shows from the service and the caches.
 * @param service - the long-pressed service
 * @param pairingCache - the known pairings
 * @param accessoryCache - the cached accessories
 */
export function buildAccessoryInfo(
  service: ServiceTypeX,
  pairingCache: PairingInfo[],
  accessoryCache: CachedAccessoryWithServices[],
): AccessoryInfoModel {
  const isMatterAccessory = service.protocol === 'matter'

  if (isMatterAccessory) {
    // For Matter accessories, use deviceType to build custom type list
    const customTypeList = [
      ...new Set(MATTER_CUSTOM_TYPE_LIST.filter(types => service.deviceType && types.includes(service.deviceType)).flat()),
    ]

    const clusters = service.clusters || {}
    const clusterInfo = Object.entries(clusters).map(([name, attributes]) => ({ name, attributes: attributes as Record<string, unknown> }))

    // Start with the standard accessoryInformation from backend, then prepend Device Type
    const accessoryInformation: InfoEntry[] = Object.entries(service.accessoryInformation || {}).map(([key, value]) => ({
      key,
      value: value as string | number | undefined,
    }))
    accessoryInformation.unshift({ key: 'Device Type', value: service.deviceType || 'Unknown' })

    return {
      isMatterAccessory,
      customTypeList,
      initialCustomType: service.customType || service.deviceType,
      accessoryInformation,
      clusterInfo,
      matchedCachedAccessory: null,
      extraServices: [],
    }
  }

  // HAP accessory - use type to build custom type list
  let customTypeList = [
    ...new Set(HAP_CUSTOM_TYPE_LIST.filter(types => types.includes(service.type)).flat()),
  ]
  let initialCustomType = service.customType

  // Speaker and SmartSpeaker render with the same tile, so only offer the variant
  // that matches the real accessory type - never list both in the dropdown
  if (service.type === 'SmartSpeaker') {
    customTypeList = customTypeList.filter(type => type !== 'Speaker')
  } else {
    customTypeList = customTypeList.filter(type => type !== 'SmartSpeaker')

    // Migrate a stale SmartSpeaker customType (set before this dedup) to Speaker
    if (initialCustomType === 'SmartSpeaker') {
      initialCustomType = 'Speaker'
    }
  }

  const accessoryInformation: InfoEntry[] = Object.entries(service.accessoryInformation).map(([key, value]) => ({
    key,
    value: value as string | number | undefined,
  }))

  const extraServices: ServiceTypeX[] = []
  if (service.type === 'LockMechanism' && service.linkedServices) {
    Object.values(service.linkedServices)
      .filter(linked => linked.type === 'LockManagement')
      .forEach(linked => extraServices.push(linked))
  }

  return {
    isMatterAccessory,
    customTypeList,
    initialCustomType: initialCustomType || service.type,
    accessoryInformation,
    clusterInfo: [],
    matchedCachedAccessory: matchToCachedAccessory(service, pairingCache, accessoryCache),
    extraServices,
  }
}

/**
 * Angular's `keyvalue` pipe: the entries sorted by key.
 * @param value - the object
 */
export function keyValue(value: Record<string, unknown>): Array<{ key: string, value: unknown }> {
  return Object.keys(value)
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(key => ({ key, value: value[key] }))
}

const enums = Enums as unknown as Record<string, Record<string, string>>

/** The HAP enum label for a characteristic value, e.g. `CurrentDoorState` 0 → `OPEN`. */
export function getEnumLabel(type: string, value: string | number | boolean): string | undefined {
  return enums[type]?.[String(value)]
}

export function fallbackCopyToClipboard(text: string): void {
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.style.position = 'fixed'
  textArea.style.left = '-999999px'
  textArea.style.top = '-999999px'
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  try {
    document.execCommand('copy')
  } catch (error) {
    console.error('Fallback: Could not copy text', error)
  }
  document.body.removeChild(textArea)
}
