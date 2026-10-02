import type { ModalComponentProps } from '@/core/ui/modal'

import { useTranslation } from 'react-i18next'

import { SafeHtml } from '@/core/ui/SafeHtml'

const translators = [
  { language: 'Finnish', github: 'l1500s' },
  { language: 'Hebrew', github: 'seidnerj' },
  { language: 'Polish', github: 'mkz212' },
  { language: 'Thai', github: 'tomzt' },
  { language: 'Traditional Chinese', github: 'rncchen' },
  { language: 'Ukrainian', github: 'xrust83' },
  { language: 'Vietnam', github: 'khanhnd88' },
]

/** A link out for a credit line; the names and urls are fixed, not user input. */
function creditLink(href: string, text: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
}

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
          <SafeHtml as="li" html={t('status.credits.created_by', { link: creditLink('https://twitter.com/nfarina', 'Nick Farina') })} />
          <SafeHtml
            as="li"
            html={t('status.credits.hap_work', {
              author: creditLink('https://twitter.com/khaost', 'Khaos Tian'),
              project: creditLink('https://github.com/homebridge/HAP-NodeJS', 'HAP-NodeJS'),
            })}
          />
          <SafeHtml as="li" html={t('status.credits.maintained_by', { link: creditLink('https://github.com/Supereg', 'Supereg') })} />
          <SafeHtml as="li" html={t('status.credits.contributors', { link: creditLink('https://github.com/homebridge/homebridge/graphs/contributors', t('status.credits.all_contributors')) })} />
        </ul>
        <h5>Homebridge Glass UI</h5>
        <ul>
          <SafeHtml as="li" html={t('status.credits.glass_by', { link: creditLink('https://github.com/mp-consulting', 'MP Consulting') })} />
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
