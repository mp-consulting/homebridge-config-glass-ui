import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { BinarySensorTile } from '@/core/accessories/types/hap/binary-sensor-tile'

import './leak-sensor.scss'

export function LeakSensorTile({ service }: HapTileProps) {
  return (
    <BinarySensorTile service={service} detected={!!service.values?.LeakDetected} className="hb-leak-sensor" typeKey="accessories.core.leak_sensor">
      <svg
        width="32px"
        height="32px"
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {/* outer casing */}
        <rect
          className="red-outline"
          x="3.5"
          y="1"
          width="25"
          height="30"
          rx="3"
          stroke="#7f7f7f"
          fill="none"
          strokeWidth="1.2"
        />
        {/* upper water droplet */}
        <g transform="translate(7, 0), scale(0.35)">
          <path
            d="M23.61 24.58C23.61 28.67 20.44 31.99 16.56 31.99C12.68 31.99 9.52 28.67 9.52 24.58C9.52 20.49 12.68 17.13 16.56 10.87C20.44 17.13 23.61 20.49 23.61 24.58Z"
            fill="#1976d2"
            fillOpacity="0.25"
            stroke="#7f7f7f"
            strokeWidth="1"
          />
        </g>
        {/* lower water droplet */}
        <g transform="translate(13, 7), scale(0.35)">
          <path
            d="M23.61 24.58C23.61 28.67 20.44 31.99 16.56 31.99C12.68 31.99 9.52 28.67 9.52 24.58C9.52 20.49 12.68 17.13 16.56 10.87C20.44 17.13 23.61 20.49 23.61 24.58Z"
            fill="#1976d2"
            fillOpacity="0.25"
            stroke="#7f7f7f"
            strokeWidth="1"
          />
        </g>
        {/* puddle */}
        <ellipse
          cx="16"
          cy="22"
          rx="10"
          ry="2"
          fill="#1976d2"
          fillOpacity="0.25"
          stroke="#7f7f7f"
          strokeWidth="0.35"
        />
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
    </BinarySensorTile>
  )
}
