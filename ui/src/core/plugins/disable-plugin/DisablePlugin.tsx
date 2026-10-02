import type { ModalComponentProps } from '@/core/ui/modal'
import type { DisablePluginModalData } from '@/core/ui/modal-data'

import { useTranslation } from 'react-i18next'

import { SafeHtml } from '@/core/ui/SafeHtml'

export type DisablePluginProps = DisablePluginModalData & ModalComponentProps

/** "Disable this plugin?" - explains what happens to its accessories first. */
export function DisablePlugin({
  activeModal,
  pluginName,
  isConfigured = false,
  isConfiguredDynamicPlatform = false,
  keepOrphans = false,
}: DisablePluginProps) {
  const { t } = useTranslation()

  const keepOrphansName = `<code>${t('settings.startup.keep_accessories')}</code>`
  const keepOrphansValue = `<code>${keepOrphans}</code>`

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const closeModal = () => activeModal.close()

  return (
    <div className="modal-content">
      <div className="modal-header">
        <h5 className="modal-title">{pluginName}</h5>
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="modal"
          aria-label={t('form.button_close')}
          onClick={dismissModal}
        >
        </button>
      </div>
      <div className="modal-body">
        <div className="mb-3 text-center">
          <i className="fas fa-circle-pause primary-text icon-xl"></i>
        </div>
        {isConfigured && (isConfiguredDynamicPlatform
          ? (
              <ul className="mb-3">
                <SafeHtml
                  as="li"
                  html={t('plugins.manage.confirm_disable_setting', { setting: keepOrphansName, value: keepOrphansValue })}
                />
                <ul className="mb-1">
                  {keepOrphans
                    ? (
                        <>
                          <li>{t('plugins.manage.confirm_disable_platform_1')}</li>
                          <li>{t('plugins.manage.confirm_disable_platform_2')}</li>
                        </>
                      )
                    : (
                        <>
                          <li>{t('plugins.manage.confirm_disable_accessory_1')}</li>
                          <li>{t('plugins.manage.confirm_disable_accessory_2')}</li>
                        </>
                      )}
                </ul>
              </ul>
            )
          : (
              <ul className="mb-3">
                <li>{t('plugins.manage.confirm_disable_accessory_1')}</li>
                <li>{t('plugins.manage.confirm_disable_accessory_2')}</li>
              </ul>
            ))}
        {/* <ngb-alert type="warning" [dismissible]="false"> */}
        <div role="alert" className="mb-0 alert show alert-warning fade">
          <p className="w-100 text-center mb-0">
            {t('plugins.manage.confirm_disable', { pluginName })}
          </p>
        </div>
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button type="button" className="btn btn-danger" data-bs-dismiss="modal" onClick={closeModal}>
            {t('plugins.manage.disable')}
          </button>
        </div>
      </div>
    </div>
  )
}
