import type { ReactNode } from 'react'

import { RequiredIndicator } from '@/core/components/required-indicator/RequiredIndicator'

export interface UserFieldProps {
  id: string
  label: string
  type: 'text' | 'password'
  value: string
  autoComplete: string
  autoCapitalize?: string
  invalid: boolean
  disabled?: boolean
  /** Whether the label carries the required asterisk (default true) */
  required?: boolean
  onChange: (value: string) => void
  onBlur: () => void
}

/** One text row of the add / edit user forms. */
export function UserField({ id, label, type, value, autoComplete, autoCapitalize, invalid, disabled, required = true, onChange, onBlur }: UserFieldProps) {
  return (
    <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
      <label htmlFor={id} className="mb-2 mb-md-0 w-100 w-md-50">
        {label}
        {required && <RequiredIndicator />}
      </label>
      <div className="text-start text-md-end w-100 w-md-50">
        <input
          type={type}
          id={id}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          className={`form-control custom-input${invalid ? ' is-invalid' : ''}`}
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
          onBlur={onBlur}
        />
      </div>
    </li>
  )
}

/** The "admin user" switch row of the add / edit user forms. */
export function AdminField({ label, checked, disabled, onChange }: { label: string, checked: boolean, disabled?: boolean, onChange: (checked: boolean) => void }): ReactNode {
  return (
    <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
      <span className="text-start">
        {label}
        <RequiredIndicator />
      </span>
      <div className="text-end grey-text d-flex align-items-center">
        <input
          type="checkbox"
          className="rendux-input"
          id="isAdmin"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
        />
        <label htmlFor="isAdmin" className="rendux-label ms-3"></label>
      </div>
    </li>
  )
}
