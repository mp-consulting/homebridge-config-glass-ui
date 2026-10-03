import { useTranslation } from 'react-i18next'

import { cx } from '@/core/utilities/cx'

export interface InlineSpinnerProps {
  /** Extra classes for the icon (`icon-xl`, `fa-2xl`, `grey-text`, …). */
  className?: string
  /** What is loading, for a screen reader; "Loading" by default. */
  label?: string
}

/**
 * A spinning `fa-circle-notch` for a value, a panel or a button that is
 * loading. The icon is the same markup the pages always drew (so the styles
 * that target it still match); a visually hidden status says what it means,
 * where the bare icon said nothing at all to a screen reader.
 *
 * A button that keeps its text while busy only needs `aria-hidden` on its icon.
 */
export function InlineSpinner({ className, label }: InlineSpinnerProps) {
  const { t } = useTranslation()
  return (
    <>
      <i className={cx('fas fa-circle-notch fa-spin', className)} aria-hidden="true"></i>
      <span className="visually-hidden" role="status">{label ?? t('common.a11y.loading')}</span>
    </>
  )
}
