import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import type { NodeJsInfo, ServerInfo } from './system-info.interfaces'

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { cx } from '@/core/utilities/cx'
import { useNamespace, useNamespaceConnected } from '@/core/ws'

import './system-info-widget.scss'

const arch64bitList = [
  'x64',
  'amd64',
  'arm64',
  'aarch64',
  'ppc64',
  'ppc64le',
  's390x',
  'riscv64',
  'loongarch64',
  'mips64el',
  'mips64',
  'sparc64',
]

/** Angular's `titlecase` pipe. */
function titleCase(value: string | undefined): string {
  return (value ?? '').replace(/\S+/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase())
}

export function SystemInfoWidget({ widget }: WidgetProps) {
  const { t } = useTranslation()
  const io = useNamespace('status')
  // An empty shape rather than nothing: the template reads nested fields
  const [serverInfo, setServerInfo] = useState<ServerInfo>({ network: {}, os: {}, time: {} } as ServerInfo)
  // Until the server answers the card would be an empty table
  const [loaded, setLoaded] = useState(false)
  const [nodejsInfo, setNodejsInfo] = useState<NodeJsInfo>({} as NodeJsInfo)

  // Re-read on every (re)connect: the server may have been updated while it was away
  const getSystemInfo = useCallback(() => {
    void io?.request<ServerInfo>('get-homebridge-server-info').then((data) => {
      setServerInfo(data)
      setLoaded(true)
    })
    void io?.request<NodeJsInfo>('nodejs-version-check').then(data => setNodejsInfo(data))
  }, [io])

  useNamespaceConnected(io, getSystemInfo)

  const { os, network, time } = serverInfo

  const osText = () => {
    switch (os.platform) {
      case 'darwin':
        return `${os.distro} ${os.codename} (${os.release})`
      case 'win32':
        return os.distro
      default:
        return `${os.distro} ${titleCase(os.codename)} (${os.release})`
    }
  }

  return (
    <div className="hb-system-info-widget flex-column d-flex align-items-stretch h-100 w-100 pb-1 overflow-auto no-scrollbars">
      <div className={cx('drag-handler p-2', widget.draggable && 'widget-cursor')}>{t('status.widget.info')}</div>
      {!loaded && (
        <div className="d-flex flex-grow-1 align-items-center justify-content-center" role="status" aria-label={t('status.widget.info.loading')}>
          <InlineSpinner className="fa-2xl grey-text" />
        </div>
      )}
      <div className="d-flex flex-wrap w-100 px-1" hidden={!loaded}>
        <table className="table table-sm table-borderless gridster-item-content">
          <tbody>
            {'homebridgeRunningInSynologyPackage' in serverInfo && (
              <>
                <tr>
                  <th scope="row" className="text-nowrap">{t('status.widget.info.os')}</th>
                  {!serverInfo.homebridgeRunningInSynologyPackage
                    ? <td className="grey-text">{osText()}</td>
                    : <td className="grey-text">Synology DSM</td>}
                </tr>
                <tr>
                  <th scope="row" className="text-nowrap">{t('status.widget.info.arch')}</th>
                  <td className="grey-text">
                    {`${os.arch} (${arch64bitList.includes(os.arch) ? '64-bit' : '32-bit'})`}
                  </td>
                </tr>
              </>
            )}
            {network.ip4 && (
              <tr>
                <th scope="row" className="text-nowrap">
                  {`${t('status.widget.info.ipv4')} (${network.iface})`}
                </th>
                <td className="grey-text">{network.ip4}</td>
              </tr>
            )}
            {network.ip6 && (
              <tr>
                <th scope="row" className="text-nowrap">
                  {`${t('status.widget.info.ipv6')} (${network.iface})`}
                </th>
                <td className="grey-text">{network.ip6}</td>
              </tr>
            )}
            {os.hostname && (
              <tr>
                <th scope="row" className="text-nowrap">{t('status.widget.info.hostname')}</th>
                <td className="grey-text">{os.hostname}</td>
              </tr>
            )}
            {'serviceUser' in serverInfo && (
              <tr>
                <th scope="row" className="text-nowrap">{t('status.widget.info.service_user')}</th>
                <td className="grey-text">{serverInfo.serviceUser}</td>
              </tr>
            )}
            {'installPath' in nodejsInfo && (
              <tr>
                <th scope="row" className="text-nowrap">{t('status.widget.info.nodejs_path')}</th>
                <td className="grey-text">{nodejsInfo.installPath}</td>
              </tr>
            )}
            {'homebridgeStoragePath' in serverInfo && (
              <tr>
                <th scope="row" className="text-nowrap">{t('status.widget.info.storage_path')}</th>
                <td className="grey-text">{serverInfo.homebridgeStoragePath}</td>
              </tr>
            )}
            {'homebridgeConfigJsonPath' in serverInfo && (
              <tr>
                <th scope="row" className="text-nowrap">{t('status.widget.info.config_path')}</th>
                <td className="grey-text">{serverInfo.homebridgeConfigJsonPath}</td>
              </tr>
            )}
            {('homebridgeCustomPluginPath' in serverInfo || 'homebridgePluginPath' in serverInfo) && (
              <tr>
                <th scope="row" className="text-nowrap">{t('status.widget.info.plugin_path')}</th>
                <td className="grey-text">
                  {serverInfo.homebridgeCustomPluginPath || serverInfo.homebridgePluginPath}
                </td>
              </tr>
            )}
            {time.timezone && (
              <tr>
                <th scope="row" className="text-nowrap">{t('status.widget.info.timezone')}</th>
                <td className="grey-text">{time.timezone}</td>
              </tr>
            )}
            {serverInfo.homebridgeRunningInDocker && (
              <tr>
                <th scope="row" className="text-nowrap">{t('status.widget.info.docker')}</th>
                <td className="text-nowrap grey-text">{t('status.widget.info.yes')}</td>
              </tr>
            )}
            {serverInfo.homebridgeRunningInSynologyPackage && (
              <tr>
                <th scope="row" className="text-nowrap">{t('status.widget.info.synology_package')}</th>
                <td className="text-nowrap grey-text">{t('status.widget.info.yes')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
