import type { FieldKey, SavingKey } from '@/modules/settings/settings-page.store'
import type { SettingsSection } from '@/modules/settings/settings-search'
import type { InputHTMLAttributes, ReactNode } from 'react'

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useField, useItemHidden, useSaving, useSettingsPage, useSettingsPageState } from '@/modules/settings/settings-page.context'

/**
 * The pieces every settings section is built from. Each renders exactly the
 * markup the Angular template repeated for it, so the page's styles and the
 * parity selectors apply unchanged.
 */

export const SAVE_INDICATOR_CLASS = 'fas fa-floppy-disk primary-text fa-xl me-0 me-md-2 ms-2 ms-md-0 order-2 order-md-1 save-indicator'

/** The floppy disk shown while a field saves. */
export function SaveIndicator({ show, className = SAVE_INDICATOR_CLASS }: { show: boolean, className?: string }) {
  return show ? <i aria-hidden="true" className={className}></i> : null
}

/** The save indicator of one field. */
export function FieldSaveIndicator({ saving }: { saving: SavingKey }) {
  return <SaveIndicator show={useSaving(saving)} />
}

/**
 * One row (`li.setting-row`). It is collapsed and made inert, not removed,
 * when the search hides it, so the rows animate in and out.
 * Pass `hidden` instead of `item` for a row whose visibility has extra conditions.
 */
export function SettingRow({ item, hidden, children }: { item?: string, hidden?: boolean, children: ReactNode }) {
  const searchHidden = useItemHidden(item ?? '')
  const isHidden = hidden ?? (item ? searchHidden : false)
  return (
    <li className={`setting-row list-group-item${isHidden ? ' setting-hidden' : ''}`} inert={isHidden || undefined}>
      {children}
    </li>
  )
}

/** The `.setting-row-inner` of a row whose control sits on its own line on small screens. */
export const INNER_BLOCK = 'setting-row-inner d-block d-md-flex justify-content-between align-items-center'
/** The `.setting-row-inner` of a row with a switch or a button on the right. */
export const INNER_FLEX = 'setting-row-inner d-flex justify-content-between align-items-center'
/** The wrapper of a text, number or select control. */
export const CONTROL_WRAP = 'my-3 my-md-0 ps-0 ps-md-5 w-auto d-flex align-items-center'

/**
 * A section: the disclosure heading, then its list of rows.
 */
export function SectionShell({ section, fieldsId, title, ulClassName = 'list-group list-group-box mt-2 mx-0', description, children }: {
  section: SettingsSection
  fieldsId: string
  title: string
  ulClassName?: string
  description?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const page = useSettingsPage()
  const open = useSettingsPageState(state => state.showFields[section])

  return (
    <div className="my-4 settings-section" id={`settings-section-${section}`}>
      <h5 className="primary-text mt-3">
        <button
          type="button"
          className="disclosure-toggle"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={fieldsId}
          onClick={() => page.toggleSection(section)}
        >
          <i aria-hidden="true" className={`fa ${open ? 'fa-chevron-down' : 'fa-chevron-right'}`}></i>
          {' '}
          {t(title)}
        </button>
      </h5>
      {open && (
        <>
          {description && <p className="small grey-text mb-2 mx-0">{t(description)}</p>}
          <ul className={ulClassName} id={fieldsId}>
            {children}
          </ul>
        </>
      )}
    </div>
  )
}

/** A rendux switch bound to a boolean field, with its save indicator. */
export function SwitchControl({ field, id, label, saving, title, indicatorClassName }: {
  field: FieldKey
  id: string
  label: string
  saving?: SavingKey
  /** The tooltip on the wrapper (the protocol switches). */
  title?: string
  indicatorClassName?: string
}) {
  const [value, change] = useField(field)
  const isSaving = useSaving(saving ?? field)
  return (
    <div className="d-flex align-items-center" title={title}>
      <div className="order-1 order-md-2">
        <input
          type="checkbox"
          className="rendux-input"
          id={id}
          checked={!!value}
          aria-label={label}
          onChange={event => change(event.target.checked as never)}
        />
        <label htmlFor={id} className="rendux-label ms-3 min-w-50"></label>
      </div>
      <SaveIndicator show={isSaving} className={indicatorClassName} />
    </div>
  )
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>

/** A text input bound to a string field. */
export function TextInput({ field, ...rest }: InputProps & { field: FieldKey }) {
  const [value, change] = useField(field)
  return (
    <input
      type="text"
      {...rest}
      value={(value as string | null) ?? ''}
      onChange={event => change(event.target.value as never)}
    />
  )
}

/**
 * A number input bound to a number field. Like Angular's number accessor, an
 * empty box is `null` and anything else goes through `parseFloat`. The text is
 * kept locally so a half-typed number ("1.") is not overwritten while typing.
 */
export function NumberInput({ field, ...rest }: InputProps & { field: FieldKey }) {
  const [value, change] = useField(field)
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value))
  const shownRef = useRef(value)

  if (shownRef.current !== value) {
    // Changed from outside (a save put it back, a read filled it in)
    shownRef.current = value
    const typed = text === '' ? null : Number.parseFloat(text)
    if (typed !== value) {
      setText(value === null || value === undefined ? '' : String(value))
    }
  }

  return (
    <input
      type="number"
      {...rest}
      value={text}
      onChange={(event) => {
        const next = event.target.value === '' ? null : Number.parseFloat(event.target.value)
        setText(event.target.value)
        shownRef.current = next as never
        change(next as never)
      }}
    />
  )
}

/** The warning shown under the rows an installed app cannot change. */
export function PwaWarning() {
  const { t } = useTranslation()
  const isPwa = useSettingsPageState(state => state.flags.isPwa)
  if (!isPwa) {
    return null
  }
  return (
    <>
      <br />
      <small className="grey-text pe-2">
        <i aria-hidden="true" className="fas fa-exclamation-triangle red-text"></i>
        {' '}
        {t('settings.warning_pwa')}
      </small>
    </>
  )
}

/** A row with a label, a description and the arrow button that opens its modal. */
export function ModalRow({ item, title, desc, label, onClick }: { item: string, title: string, desc: string, label: string, onClick: () => void }) {
  return (
    <SettingRow item={item}>
      <div className={INNER_FLEX}>
        <span className="pe-2">
          {title}
          <br />
          <small className="grey-text pe-2">{desc}</small>
        </span>
        <button
          type="button"
          className="btn btn-primary waves-effect m-0 ms-3 py-1 min-w-50"
          aria-label={label}
          onClick={onClick}
        >
          <i aria-hidden="true" className="fas fa-arrow-right"></i>
        </button>
      </div>
    </SettingRow>
  )
}
