import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { DoorbellManage } from '@/core/accessories/types/hap/lazy-manage'
import { MediaTile } from '@/core/accessories/types/hap/media-tile'

export function DoorbellTile(props: HapTileProps) {
  return (
    <MediaTile {...props} className="hb-doorbell" manage={DoorbellManage} ariaKey="accessories.core.doorbell" fallbackKey="accessories.core.doorbell">
      <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        {/* outer casing */}
        <rect x="6" y="1" width="18" height="30" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="2" />
        {/* power button */}
        <circle cx="15" cy="16" r="5" stroke="#7f7f7f" strokeWidth="2" fill="#1976d2" fillOpacity="0.5" />
      </svg>
    </MediaTile>
  )
}
