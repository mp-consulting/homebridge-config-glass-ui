import { Dropdown } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import { useSettingsStore } from '@/core/settings'

/** Only http(s) links are ever rendered, whatever the settings hold. */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * The menu header's switch to the other Homebridge UIs listed in Settings >
 * Instances. Picking one simply navigates to it: nothing is proxied, and the
 * other instance asks for its own sign-in.
 */
export function InstanceSwitcher() {
  const { t } = useTranslation()
  const instances = useSettingsStore(state => state.env.instances)
  const name = useSettingsStore(state => state.env.homebridgeInstanceName)
  const links = (instances ?? []).filter(instance => isSafeUrl(instance.url))

  if (!links.length) {
    return null
  }

  return (
    <Dropdown className="hb-instance-switcher px-3 pb-2">
      <Dropdown.Toggle variant="link" size="sm" className="w-100 text-start text-truncate p-0" aria-label={t('instances.switch')}>
        <i className="fas fa-server me-2" aria-hidden="true"></i>
        {name || t('instances.this')}
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Header>{t('instances.switch')}</Dropdown.Header>
        {links.map(instance => (
          <Dropdown.Item key={`${instance.name}|${instance.url}`} href={instance.url} rel="noopener noreferrer">
            {instance.name}
            <br />
            <small className="grey-text">{instance.url}</small>
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  )
}
