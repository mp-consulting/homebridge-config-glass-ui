import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'

import { PositionManage } from '@/core/accessories/types/hap/position-manage'

export function WindowManage(props: HapManageProps) {
  return <PositionManage {...props} guardUpdate />
}
