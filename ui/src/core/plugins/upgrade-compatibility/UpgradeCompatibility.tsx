import type { PluginCompatibilityReport, UpgradeTarget } from './upgrade-compatibility'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'

import { fetchUpgradeCompatibility } from './upgrade-compatibility'

export interface UpgradeCompatibilityProps {
  /** The Node.js and/or Homebridge version about to be installed. */
  target: UpgradeTarget
}

/**
 * Before a Node.js or Homebridge upgrade: the installed plugins whose
 * `engines` range does not accept the new version, and how many do not say.
 * Renders nothing when every plugin is fine, or when the check fails (it is
 * advice, never a blocker).
 */
export function UpgradeCompatibility({ target }: UpgradeCompatibilityProps) {
  const { t } = useTranslation()
  const { node, homebridge } = target
  const key = `${node ?? ''}|${homebridge ?? ''}`
  // The answer is kept with the target it is for, so a new target shows the spinner again
  const [result, setResult] = useState<{ key: string, report: PluginCompatibilityReport | null } | null>(null)
  const loading = result?.key !== key
  const report = loading ? null : result.report

  useEffect(() => {
    let active = true
    fetchUpgradeCompatibility({ node, homebridge }).then(
      (value) => {
        if (active) {
          setResult({ key, report: value })
        }
      },
      (error) => {
        console.error(error)
        if (active) {
          setResult({ key, report: null })
        }
      },
    )
    return () => {
      active = false
    }
  }, [key, node, homebridge])

  if (loading) {
    return (
      <div className="text-center grey-text small mb-3 hb-upgrade-compatibility">
        <InlineSpinner />
        {' '}
        {t('plugins.compat.upgrade_checking')}
      </div>
    )
  }
  if (!report || (!report.incompatible.length && !report.unknown.length)) {
    return null
  }

  const engineLabel = (engine: 'node' | 'homebridge') => (engine === 'node' ? `Node.js v${report.target.node}` : `Homebridge v${report.target.homebridge}`)

  return (
    <div className="hb-upgrade-compatibility mb-3">
      {report.incompatible.length > 0 && (
        <div role="alert" className="alert alert-warning show fade mb-2">
          <p className="mb-2">
            <i className="fas fa-triangle-exclamation me-2" aria-hidden="true"></i>
            {t('plugins.compat.upgrade_incompatible', { count: report.incompatible.length })}
          </p>
          <ul className="mb-0 small">
            {report.incompatible.map(plugin => (
              <li key={plugin.name}>
                <strong>{plugin.displayName}</strong>
                {plugin.installedVersion && ` v${plugin.installedVersion}`}
                {' — '}
                {plugin.engineIssues.map(engine => t('plugins.compat.upgrade_requires', {
                  range: plugin.engines[engine],
                  target: engineLabel(engine),
                })).join('; ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.unknown.length > 0 && (
        <p className="grey-text small mb-0">
          {t('plugins.compat.upgrade_unknown', { count: report.unknown.length, plugins: report.unknown.map(p => p.displayName).join(', ') })}
        </p>
      )}
    </div>
  )
}
