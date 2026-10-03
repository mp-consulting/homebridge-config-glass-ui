import type { ModalComponentProps } from '@/core/ui/modal'
import type { ChangeEvent } from 'react'

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { formatMegabytes } from '@/core/pipes/bytes'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { toastApiError } from '@/core/utilities/http-error'
import { environment } from '@/environments/environment'

import './wallpaper.scss'

/** Upload, preview or remove the custom wallpaper. */
export function Wallpaper({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const wallpaperInputRef = useRef<HTMLInputElement>(null)
  const [originalWallpaperUrl] = useState<string | null>(() => {
    const hash = useSettingsStore.getState().env.customWallpaperHash
    return hash ? `${environment.api.base}/auth/wallpaper/${hash}` : null
  })
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(originalWallpaperUrl)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [clicked, setClicked] = useState(false)
  const maxFileSizeText: string = globalThis.backup.maxBackupSizeText

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files?.length) {
      const file = files[0]
      // Validate size before base64-encoding the bytes into a Data URL
      // for preview — large images otherwise pin the renderer thread
      // and then the server rejects the upload anyway.
      if (file.size > globalThis.backup.maxBackupSize) {
        event.target.value = ''
        setSelectedFile(null)
        setWallpaperUrl(originalWallpaperUrl)
        toast.error(
          i18n.t('backup.backup_exceeds_max_size', {
            maxBackupSizeText: maxFileSizeText,
            size: formatMegabytes(file.size),
          }),
          i18n.t('toast.title_error'),
        )
        return
      }
      setSelectedFile(file)
      const reader = new FileReader()
      reader.onload = (e: ProgressEvent<FileReader>) => {
        setWallpaperUrl(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    } else {
      setSelectedFile(null)
      setWallpaperUrl(originalWallpaperUrl)
    }
  }

  const saveWallpaper = async () => {
    setClicked(true)
    try {
      if (selectedFile) {
        const formData: FormData = new FormData()
        formData.append('wallpaper', selectedFile, selectedFile.name)
        await api.post('/server/wallpaper', formData)
        settingsActions.setItem('wallpaper', `ui-wallpaper.${selectedFile.name.split('.').pop()}`)
        activeModal.close()
        toast.success(t('settings.display.wallpaper_success'), t('toast.title_success'))
      } else {
        await api.delete('/server/wallpaper')
        activeModal.close()
      }
    } catch (error) {
      console.error(error)
      toastApiError(error)
      setClicked(false)
    }
  }

  const clearWallpaper = () => {
    setSelectedFile(null)
    setWallpaperUrl(wallpaperUrl === originalWallpaperUrl ? null : originalWallpaperUrl)
    if (wallpaperInputRef.current) {
      wallpaperInputRef.current.value = ''
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content hb-wallpaper">
      <ModalHeader title={t('settings.display.wallpaper')} closeDisabled={clicked} onClose={dismissModal} />
      <div className="modal-body">
        <div className="text-center mb-3">
          <i className="fas fa-image primary-text icon-xl"></i>
        </div>
        <ul className="mb-3">
          <li>{t('settings.display.wallpaper_intro')}</li>
          <li>{t('settings.display.wallpaper_rule', { maxFileSizeText })}</li>
          <li>{t('settings.display.wallpaper_rule2')}</li>
        </ul>
        <div className="mb-3 text-center">
          {wallpaperUrl
            ? (
                <div className="position-relative d-inline-block">
                  <img
                    className="img-fluid rounded mx-auto d-block wallpaper-preview"
                    alt="Current Wallpaper"
                    src={wallpaperUrl}
                  />
                  <button
                    type="button"
                    className="btn btn-danger position-absolute wallpaper-delete-btn"
                    aria-label={t('form.button_delete')}
                    onClick={clearWallpaper}
                  >
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              )
            : <div className="gradient anim rounded wallpaper-placeholder"></div>}
        </div>
        <div className="mb-0">
          <input
            ref={wallpaperInputRef}
            type="file"
            id="wallpaper"
            className="form-control"
            accept="image/*"
            onChange={onFileChange}
          />
        </div>
      </div>
      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            disabled={clicked}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button
            type="button"
            className="btn btn-primary"
            data-bs-dismiss="modal"
            disabled={wallpaperUrl === originalWallpaperUrl || clicked}
            onClick={() => void saveWallpaper()}
          >
            {t('form.button_save')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
