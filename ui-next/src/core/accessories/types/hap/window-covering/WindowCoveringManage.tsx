import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'

import { PositionManage } from '@/core/accessories/types/hap/position-manage'

export function WindowCoveringManage(props: HapManageProps) {
  return <PositionManage {...props} guardUpdate tilt />
}
