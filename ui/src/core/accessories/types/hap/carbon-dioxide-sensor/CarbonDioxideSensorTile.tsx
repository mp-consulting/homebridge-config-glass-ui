import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { BinarySensorTile } from '@/core/accessories/types/hap/binary-sensor-tile'

import './carbon-dioxide-sensor.scss'

export function CarbonDioxideSensorTile({ service }: HapTileProps) {
  return (
    <BinarySensorTile service={service} detected={!!service.values?.CarbonDioxideDetected} className="hb-carbon-dioxide-sensor" typeKey="accessories.core.carbon_dioxide_sensor">
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
          CO2
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
          d="M3,24.0706147 C3.28945166,24.8007217 5.978098,25.1773883 10.0660175,25.2006147 C12.5085124,25.2144929 18.5053297,22.8514837 22.4060749,22.1943647 C24.1588716,21.898084 26.5955382,22.1756219 28.716875,23.0221772"
          className="air-line"
          stroke="#7f7f7f"
          fill="transparent"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* bottom wave */}
        <path
          d="M3,30.0706147 C3.28945166,30.8007217 5.978098,31.1773883 10.0660175,31.2006147 C12.5085124,31.2144929 18.5053297,28.8514837 22.4060749,28.1943647 C24.1588716,27.898084 26.5955382,28.1756219 28.716875,29.0221772"
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
