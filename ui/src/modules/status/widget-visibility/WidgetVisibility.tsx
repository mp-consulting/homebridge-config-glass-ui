import type { ModalComponentProps } from '@/core/ui/modal'
import type { WidgetVisibilityModalData } from '@/core/ui/modal-data'

import type { Widget } from '../widgets/widget.types'
import type { WidgetVisibilityEntry } from './widget-visibility.entries'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SafeHtml } from '@/core/ui/SafeHtml'

import { visibilityEntries } from './widget-visibility.entries'

export type WidgetVisibilityProps = WidgetVisibilityModalData & ModalComponentProps<WidgetVisibilityEntry[]> & {
  dashboard: Array<Partial<Widget>>
}

/**
 * Show / hide modal: one desktop and one mobile checkbox per widget, plus the
 * reset-to-default-layout action. Closes with every entry, the hide flags
 * set from the checkboxes; reset dismisses instead, so the caller does not then
 * apply these entries on top of the fresh layout.
 */
export function WidgetVisibility({ activeModal, dashboard, resetLayout }: WidgetVisibilityProps) {
  const { t } = useTranslation()

  const [original] = useState(() => visibilityEntries(dashboard, t))
  const [availableWidgets, setAvailableWidgets] = useState(original)

  const isFormUnchanged = useMemo(() => availableWidgets.every((w, i) =>
    w.showOnDesktop === original[i].showOnDesktop && w.showOnMobile === original[i].showOnMobile), [availableWidgets, original])

  const toggle = (component: string, field: 'showOnDesktop' | 'showOnMobile') => {
    setAvailableWidgets(widgets => widgets.map(w => (w.component === component ? { ...w, [field]: !w[field] } : w)))
  }

  const saveModal = () => {
    activeModal.close(availableWidgets.map(w => ({
      ...w,
      hideOnDesktop: !w.showOnDesktop,
      hideOnMobile: !w.showOnMobile,
    })))
  }

  const doResetLayout = () => {
    resetLayout()
    activeModal.dismiss()
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <div className="modal-header">
        <h5 className="modal-title">{t('status.widget.show_hide')}</h5>
        <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label={t('form.button_close')} onClick={dismissModal}></button>
      </div>
      <div className="modal-body">
        {availableWidgets.length > 0 && (
          <ul className="list-group list-group-box mb-4">
            <li className="list-group-item text-center grey-text">
              <div className="small">
                <SafeHtml as="span" html={t('status.widget.account_1')} />
                <br />
                <SafeHtml as="span" html={t('status.widget.account_2')} />
              </div>
            </li>
            {availableWidgets.map(widget => (
              <li key={widget.component} className="list-group-item">
                <div className="mb-2">{widget.name}</div>
                <div className="d-flex justify-content-between align-items-center mb-1 grey-text">
                  <span aria-hidden="true">{t('status.widget.show_on_desktop')}</span>
                  <span className="d-flex align-items-center">
                    <i className="fas fa-desktop fa-lg" aria-hidden="true"></i>
                    <input
                      type="checkbox"
                      className="rendux-input"
                      checked={widget.showOnDesktop}
                      id={`desktop-${widget.component}`}
                      aria-label={t('status.widget.show_on_desktop')}
                      onChange={() => toggle(widget.component, 'showOnDesktop')}
                    />
                    <label className="rendux-label ms-2" aria-hidden="true" htmlFor={`desktop-${widget.component}`}></label>
                  </span>
                </div>
                <div className="d-flex justify-content-between align-items-center grey-text">
                  <span aria-hidden="true">{t('status.widget.show_on_mobile')}</span>
                  <span className="d-flex align-items-center">
                    <i className="fas fa-mobile-screen-button fa-lg" aria-hidden="true"></i>
                    <input
                      type="checkbox"
                      className="rendux-input"
                      checked={widget.showOnMobile}
                      id={`mobile-${widget.component}`}
                      aria-label={t('status.widget.show_on_mobile')}
                      onChange={() => toggle(widget.component, 'showOnMobile')}
                    />
                    <label className="rendux-label ms-2" aria-hidden="true" htmlFor={`mobile-${widget.component}`}></label>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <ul className="list-group list-group-box mb-0">
          <li className="list-group-item d-flex justify-content-between align-items-center">
            <div>
              <span>{t('form.button_reset')}</span>
              <br />
              <small className="grey-text">{t('status.widget.reset')}</small>
            </div>
            <button type="button" className="btn btn-danger m-0 ms-3 py-1" data-bs-dismiss="modal" aria-label={t('form.button_reset')} onClick={doResetLayout}>
              <i className="fas fa-arrow-right"></i>
            </button>
          </li>
        </ul>
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start">
          <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" aria-label={t('form.button_close')} onClick={dismissModal}>
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button type="button" className="btn btn-primary" disabled={isFormUnchanged} onClick={saveModal}>
            {t('form.button_save')}
          </button>
        </div>
      </div>
    </div>
  )
}
