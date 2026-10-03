import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { MediaTile } from '@/core/accessories/types/hap/media-tile'
import { MicrophoneManage } from '@/core/accessories/types/hap/microphone/MicrophoneManage'

export function MicrophoneTile(props: HapTileProps) {
  return (
    <MediaTile {...props} className="hb-microphone" manage={MicrophoneManage} ariaKey="accessories.core.microphone" fallbackKey="accessories.control.microphone">
      <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        {/* outer casing */}
        <rect x="6" y="1" width="18" height="30" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="2" />
        {/* grille lines */}
        <line strokeLinecap="round" x1="10" y1="6" x2="20" y2="6" stroke="#7f7f7f" strokeWidth="2" />
        <line strokeLinecap="round" x1="10" y1="10" x2="20" y2="10" stroke="#7f7f7f" strokeWidth="2" />
        <line strokeLinecap="round" x1="10" y1="14" x2="20" y2="14" stroke="#7f7f7f" strokeWidth="2" />
        {/* power button */}
        <circle cx="15" cy="23" r="3" stroke="#7f7f7f" strokeWidth="2" fill="#1976d2" fillOpacity="0.5" />
      </svg>
    </MediaTile>
  )
}
