import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { BinarySensorTile } from '@/core/accessories/types/hap/binary-sensor-tile'

import './smoke-sensor.scss'

export function SmokeSensorTile({ service }: HapTileProps) {
  return (
    <BinarySensorTile service={service} detected={!!service.values?.SmokeDetected} className="hb-smoke-sensor" typeKey="accessories.core.smoke_sensor">
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
          SMOKE
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
        {/* left to right air lines */}
        <line
          strokeLinecap="round"
          x1="11"
          y1="21"
          x2="6"
          y2="27"
          stroke="#7f7f7f"
          strokeWidth="1.25"
          className="air-line"
        />
        <line
          strokeLinecap="round"
          x1="16"
          y1="21"
          x2="16"
          y2="31"
          stroke="#7f7f7f"
          strokeWidth="1.25"
          className="air-line"
        />
        <line
          strokeLinecap="round"
          x1="21"
          y1="21"
          x2="26"
          y2="27"
          stroke="#7f7f7f"
          strokeWidth="1.25"
          className="air-line"
        />
      </svg>
    </BinarySensorTile>
  )
}
