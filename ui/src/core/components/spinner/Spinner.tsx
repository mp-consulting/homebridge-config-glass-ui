import { useTranslation } from 'react-i18next'

import './spinner.scss'

export function Spinner() {
  const { t } = useTranslation()
  return (
    <div className="app-spinner-container" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{t('common.a11y.loading')}</span>
      <div className="animate_loader" aria-hidden="true">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          xmlnsXlink="http://www.w3.org/1999/xlink"
          className="spinner-svg"
          width="200px"
          height="200px"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid"
          focusable="false"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r="32"
            strokeWidth="8"
            stroke="currentColor"
            className="spinner_outer"
            strokeDasharray="50.26548245743669 50.26548245743669"
            fill="none"
            strokeLinecap="round"
          />
          <circle
            cx="50"
            cy="50"
            r="23"
            strokeWidth="8"
            stroke="currentColor"
            className="spinner_inner"
            strokeDasharray="36.12831551628262 36.12831551628262"
            strokeDashoffset="36.12831551628262"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  )
}
