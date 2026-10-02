import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { BinarySensorTile } from '@/core/accessories/types/hap/binary-sensor-tile'

import './contact-sensor.scss'

export function ContactSensorTile({ service }: HapTileProps) {
  return (
    <BinarySensorTile service={service} detected={!!service.values?.ContactSensorState} className="hb-contact-sensor" typeKey="accessories.core.contact_sensor" onKey="accessories.control.open" offKey="accessories.control.closed">
      <svg
        width="32px"
        height="32px"
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {/* left object */}
        <rect
          className="left-object"
          x="1"
          y="1"
          width="15"
          height="30"
          rx="1"
          stroke="#7f7f7f"
          fill="none"
          strokeWidth="1.5"
        />
        {/* right object */}
        <rect
          className="right-object"
          x="16"
          y="1"
          width="15"
          height="30"
          rx="1"
          stroke="#7f7f7f"
          fill="none"
          strokeWidth="1.5"
        />
        {/* left sensor */}
        <rect
          className="left-sensor"
          x="10"
          y="11"
          width="6"
          height="10"
          rx="1"
          stroke="#7f7f7f"
          fill="#4caf50"
          fillOpacity="0.5"
          strokeWidth="0.5"
        />
        {/* right sensor */}
        <rect
          className="right-sensor"
          x="16"
          y="11"
          width="6"
          height="10"
          rx="1"
          stroke="#7f7f7f"
          fill="#4caf50"
          fillOpacity="0.5"
          strokeWidth="0.5"
        />
      </svg>
    </BinarySensorTile>
  )
}
