import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'

import { PositionManage } from '@/core/accessories/types/hap/position-manage'

export function DoorManage(props: HapManageProps) {
  return <PositionManage {...props} a11y guardUpdate={false} />
}
