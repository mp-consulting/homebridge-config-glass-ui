import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { formatTemp, useTemperatureUnits } from '@/core/accessories/types/hap/hap-tile'
import { ReadingSensorTile } from '@/core/accessories/types/hap/reading-sensor-tile'

import './temperature-sensor.scss'

export function TemperatureSensorTile({ service }: HapTileProps) {
  const temperatureUnits = useTemperatureUnits()
  const reading = 'CurrentTemperature' in service.values
    ? `${formatTemp(service.values?.CurrentTemperature, temperatureUnits)}°${temperatureUnits.toUpperCase()}`
    : undefined

  return (
    <ReadingSensorTile service={service} typeKey="accessories.core.temperature_sensor" reading={reading}>
      <svg
        width="32px"
        height="32px"
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {/* outer casing */}
        <rect x="3.5" y="1" width="25" height="30" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="1.2" />
        {/* thermometer symbol */}
        <line x1="16" y1="5" x2="16" y2="17" stroke="#7f7f7f" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="16" cy="20" r="3" stroke="#7f7f7f" strokeWidth="1.2" fill="#1976d2" fillOpacity="0.5" />
        {/* left tick marks */}
        <line x1="9" y1="6" x2="13" y2="6" stroke="#7f7f7f" strokeWidth="0.8" />
        <line x1="9" y1="9" x2="13" y2="9" stroke="#7f7f7f" strokeWidth="0.8" />
        <line x1="9" y1="12" x2="13" y2="12" stroke="#7f7f7f" strokeWidth="0.8" />
        <line x1="9" y1="15" x2="13" y2="15" stroke="#7f7f7f" strokeWidth="0.8" />
        {/* right tick marks */}
        <line x1="19" y1="6" x2="23" y2="6" stroke="#7f7f7f" strokeWidth="0.8" />
        <line x1="19" y1="9" x2="23" y2="9" stroke="#7f7f7f" strokeWidth="0.8" />
        <line x1="19" y1="12" x2="23" y2="12" stroke="#7f7f7f" strokeWidth="0.8" />
        <line x1="19" y1="15" x2="23" y2="15" stroke="#7f7f7f" strokeWidth="0.8" />
        {/* grille horizontal lines */}
        <line strokeLinecap="round" x1="7" y1="26" x2="25" y2="26" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="7" y1="27.5" x2="25" y2="27.5" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="7" y1="29" x2="25" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        {/* grille vertical lines */}
        <line strokeLinecap="round" x1="7" y1="26" x2="7" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="9" y1="26" x2="9" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="11" y1="26" x2="11" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="13" y1="26" x2="13" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="15" y1="26" x2="15" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="17" y1="26" x2="17" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="19" y1="26" x2="19" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="21" y1="26" x2="21" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="23" y1="26" x2="23" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
        <line strokeLinecap="round" x1="25" y1="26" x2="25" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
      </svg>
    </ReadingSensorTile>
  )
}
