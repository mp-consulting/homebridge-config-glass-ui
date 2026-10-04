import type { ButtonHTMLAttributes } from 'react'

import { cx } from '@/core/utilities/cx'

/** The Assistant's halo button (`.mp-ai-button`) with its icon and a label. */
export function AiButton({ label, busy, size, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  busy?: boolean
  size?: 'sm' | 'lg'
}) {
  return (
    <button
      type="button"
      {...rest}
      className={cx('mp-ai-button', size === 'sm' && 'mp-ai-button-sm', size === 'lg' && 'mp-ai-button-lg', className)}
      aria-busy={busy || undefined}
    >
      <i className="fas fa-wand-magic-sparkles mp-ai-icon" aria-hidden="true"></i>
      <span>{label}</span>
    </button>
  )
}
