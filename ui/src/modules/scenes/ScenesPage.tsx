import type { Scene } from './scenes'

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '@/core/auth'
import { Confirm } from '@/core/components/confirm/Confirm'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { formatDate } from '@/core/pipes/date'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { toastApiError } from '@/core/utilities/http-error'

import { SceneEditor } from './SceneEditor'
import { scenesApi } from './scenes'

const MODAL_OPTIONS = { size: 'lg', backdrop: 'static' } as const

/** `/scenes`: run a scene, and (administrators) add, edit and delete them. */
export function ScenesPage() {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => !!state.user?.admin)
  const [scenes, setScenes] = useState<Scene[] | null>(null)
  const [running, setRunning] = useState<string | null>(null)

  useEffect(() => {
    settingsActions.setPageTitle(i18n.t('scenes.title'))
  }, [])

  const load = useCallback(async () => {
    try {
      setScenes(await scenesApi.list())
    } catch (error) {
      console.error(error)
      toastApiError(error)
      setScenes([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (scene: Scene) => {
    setRunning(scene.id)
    try {
      const result = await scenesApi.run(scene.id)
      if (result.ok) {
        toast.success(t('scenes.ran', { name: scene.name }), t('toast.title_success'))
      } else {
        const failed = result.results.filter(item => !item.ok)
        toast.warning(failed.map(item => `${item.characteristicType}: ${item.error ?? ''}`).join('\n'), t('scenes.ran_with_errors', { name: scene.name, count: failed.length }))
      }
      await load()
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
    setRunning(null)
  }

  const edit = async (scene?: Scene) => {
    try {
      await openModal(SceneEditor, { scene }, MODAL_OPTIONS).result
      await load()
    } catch {
      // Closed without saving
    }
  }

  const remove = async (scene: Scene) => {
    try {
      await openModal(Confirm, {
        title: t('form.button_delete'),
        message: t('scenes.delete_confirm', { name: scene.name }),
        confirmButtonLabel: t('form.button_delete'),
        confirmButtonClass: 'btn-danger',
        faIconClass: 'fas fa-trash primary-text',
      }, MODAL_OPTIONS).result
    } catch {
      return
    }
    try {
      await scenesApi.remove(scene.id)
      await load()
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
  }

  return (
    <div className="hb-scenes">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="m-0">{t('scenes.title')}</h4>
        {isAdmin && (
          <button type="button" className="btn btn-primary m-0" onClick={() => void edit()}>
            <i className="fas fa-plus me-2" aria-hidden="true"></i>
            {t('scenes.add')}
          </button>
        )}
      </div>
      {!scenes
        ? <div className="text-center primary-text"><InlineSpinner className="icon-xl" /></div>
        : scenes.length === 0
          ? <p className="text-center grey-text mt-4">{t(isAdmin ? 'scenes.none_admin' : 'scenes.none')}</p>
          : (
              <ul className="list-group list-group-box">
                {scenes.map(scene => (
                  <li key={scene.id} className="list-group-item d-flex justify-content-between align-items-center" data-scene={scene.id}>
                    <span>
                      {scene.name}
                      <br />
                      <small className="grey-text">
                        {t('scenes.summary', { count: scene.actions.length })}
                        {scene.schedules.some(schedule => schedule.enabled) && (
                          <>
                            {' · '}
                            <i className="far fa-clock me-1" aria-hidden="true"></i>
                            {scene.schedules.filter(schedule => schedule.enabled).map(schedule => schedule.cron).join(', ')}
                          </>
                        )}
                        {scene.lastRun && (
                          <>
                            {' · '}
                            {t('scenes.last_run', { date: `${formatDate(scene.lastRun.at, 'mediumDate')} ${formatDate(scene.lastRun.at, 'shortTime')}` })}
                            {!scene.lastRun.ok && <i className="fas fa-triangle-exclamation orange-text ms-1" aria-hidden="true"></i>}
                          </>
                        )}
                      </small>
                    </span>
                    <span className="d-flex flex-nowrap">
                      <button type="button" className="btn btn-primary m-0 ms-2" disabled={running !== null} aria-label={t('scenes.run', { name: scene.name })} onClick={() => void run(scene)}>
                        <i aria-hidden="true" className={running === scene.id ? 'fas fa-circle-notch fa-spin' : 'fas fa-play'}></i>
                      </button>
                      {isAdmin && (
                        <>
                          <button type="button" className="btn btn-elegant m-0 ms-2" aria-label={t('scenes.edit')} onClick={() => void edit(scene)}>
                            <i aria-hidden="true" className="fas fa-pen"></i>
                          </button>
                          <button type="button" className="btn btn-danger m-0 ms-2" aria-label={t('form.button_delete')} onClick={() => void remove(scene)}>
                            <i aria-hidden="true" className="fas fa-trash"></i>
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
    </div>
  )
}
