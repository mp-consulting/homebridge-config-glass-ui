import { useTranslation } from 'react-i18next'

import './drag-here-placeholder.scss'

/** What an empty room shows while the layout is unlocked. */
export function DragHerePlaceholder({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div className={className ? `hb-drag-here-placeholder ${className}` : 'hb-drag-here-placeholder'}>
      <div className="accessory-box">
        <i className="fas fa-arrow-alt-circle-down accessory-icon"></i>
        <div className="accessory-label">{t('accessories.control.drag_here')}</div>
      </div>
    </div>
  )
}
