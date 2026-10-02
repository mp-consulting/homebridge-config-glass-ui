import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'

import { MediaManage } from '@/core/accessories/types/hap/media-manage'

export function DoorbellManage(props: HapManageProps) {
  return <MediaManage {...props} />
}
