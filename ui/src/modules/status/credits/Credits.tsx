import type { ModalComponentProps } from '@/core/ui/modal'

import { useTranslation } from 'react-i18next'

const translators = [
  { language: 'Finnish', github: 'l1500s' },
  { language: 'Hebrew', github: 'seidnerj' },
  { language: 'Polish', github: 'mkz212' },
  { language: 'Thai', github: 'tomzt' },
  { language: 'Traditional Chinese', github: 'rncchen' },
  { language: 'Ukrainian', github: 'xrust83' },
  { language: 'Vietnam', github: 'khanhnd88' },
]

/** The credits modal opened from the heart in the dashboard footer. */
export function Credits({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <div className="modal-header">
        <h5 className="modal-title">{t('status.credits.title')}</h5>
        <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label={t('form.button_close')} onClick={dismissModal}></button>
      </div>
      <div className="modal-body align-items-center w-100 pb-0">
        <div className="w-100 text-center primary-text mb-3">
          <i className="fas fa-heart icon-xl"></i>
        </div>
        <h5>Homebridge</h5>
        <ul>
          <li>
            Homebridge was originally created by
            {' '}
            <a href="https://twitter.com/nfarina" target="_blank" rel="noopener noreferrer">Nick Farina</a>
            .
          </li>
          <li>
            The original HomeKit API work was done by
            {' '}
            <a href="https://twitter.com/khaost" target="_blank" rel="noopener noreferrer">Khaos Tian</a>
            {' '}
            in his
            {' '}
            <a href="https://github.com/homebridge/HAP-NodeJS" target="_blank" rel="noopener noreferrer">HAP-NodeJS</a>
            {' '}
            project.
          </li>
          <li>
            Homebridge and HAP-NodeJS have since been maintained and improved by
            {' '}
            <a href="https://github.com/Supereg" target="_blank" rel="noopener noreferrer">Supereg</a>
            .
          </li>
          <li>
            We are grateful to
            {' '}
            <a href="https://github.com/homebridge/homebridge/graphs/contributors">all contributors</a>
            {' '}
            of Homebridge since its first commit in December 2014.
          </li>
        </ul>
        <h5>Homebridge Glass UI</h5>
        <ul>
          <li>
            Homebridge Glass UI is developed and maintained by
            {' '}
            <a href="https://github.com/mp-consulting" target="_blank" rel="noopener noreferrer">MP Consulting</a>
            .
          </li>
        </ul>
        <h5>{t('status.credits.translations')}</h5>
        <ul>
          <li>
            {t('status.credits.translations_thanks')}
            <ul className="mt-1">
              {translators.map(translator => (
                <li key={translator.github}>
                  {translator.language}
                  :
                  {' '}
                  <a target="_blank" rel="noopener noreferrer" href={`https://github.com/${translator.github}`}>{translator.github}</a>
                </li>
              ))}
            </ul>
          </li>
        </ul>
        <h5>{t('menu.label_plugins')}</h5>
        <ul>
          <li>{t('status.credits.plugins_thanks')}</li>
        </ul>
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start"></div>
        <div className="text-center">
          <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" aria-label={t('form.button_close')} onClick={dismissModal}>
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-end"></div>
      </div>
    </div>
  )
}
