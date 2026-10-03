import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { BinarySensorTile } from '@/core/accessories/types/hap/binary-sensor-tile'

import './carbon-monoxide-sensor.scss'

export function CarbonMonoxideSensorTile({ service }: HapTileProps) {
  return (
    <BinarySensorTile service={service} detected={!!service.values?.CarbonMonoxideDetected} className="hb-carbon-monoxide-sensor" typeKey="accessories.core.carbon_monoxide_sensor">
      <svg
        width="32px"
        height="32px"
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {/* outer casing */}
        <rect x="1" y="1" width="30" height="12" rx="1" stroke="#7f7f7f" fill="none" strokeWidth="1.25" />
        {/* alarm type */}
        <text
          className="type"
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="Arial"
          fontSize="7.5"
          x="16"
          y="7.7"
          fill="#7f7f7f"
          strokeWidth="0.6"
          fontWeight="900"
        >
          CO
        </text>
        {/* grille blue background */}
        <line x1="6" y1="14.5" x2="25.5" y2="14.5" stroke="#1976d2" strokeOpacity="0.5" strokeWidth="2" />
        {/* grille vertical lines */}
        <line strokeLinecap="round" x1="5" y1="13" x2="6.5" y2="16" stroke="#7f7f7f" strokeWidth="1.25" />
        <line strokeLinecap="round" x1="11" y1="13" x2="11" y2="16" stroke="#7f7f7f" strokeWidth="1" />
        <line strokeLinecap="round" x1="15.5" y1="13" x2="15.5" y2="16" stroke="#7f7f7f" strokeWidth="1" />
        <line strokeLinecap="round" x1="20" y1="13" x2="20" y2="16" stroke="#7f7f7f" strokeWidth="1" />
        <line strokeLinecap="round" x1="26" y1="13" x2="24.5" y2="16" stroke="#7f7f7f" strokeWidth="1.25" />
        {/* grille horizontal lines */}
        <line strokeLinecap="round" x1="6.5" y1="16" x2="24.5" y2="16" stroke="#7f7f7f" strokeWidth="1.25" />
        {/* top wave */}
        <path
          d="M3,23 C6,25 9,21 12,23 C15,25 18,21 21,23 C24,25 27,21 30,23"
          className="air-line"
          stroke="#7f7f7f"
          fill="transparent"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* bottom wave */}
        <path
          d="M3,30 C6,32 9,28 12,30 C15,32 18,28 21,30 C24,32 27,28 30,30"
          className="air-line"
          stroke="#7f7f7f"
          fill="transparent"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </BinarySensorTile>
  )
}
