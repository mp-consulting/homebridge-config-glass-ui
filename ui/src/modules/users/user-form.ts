import type { User } from './users.interface'

/** A control's errors, as Angular's `ValidationErrors`: null when valid. */
export type ValidationErrors = Record<string, boolean> | null

/**
 * The group validator of the add and edit forms: the confirmation has to match
 * the password. It adds or removes only its own `matchPassword` error on the
 * confirmation field, keeping any other error already there - overwriting them
 * wholesale would clear `required`, so an empty confirmation box would look valid.
 * @param password - the password field value
 * @param passwordConfirm - the confirmation field value
 * @param confirmErrors - the errors already on the confirmation field
 * @returns the group's error and the confirmation field's new errors
 */
export function matchPassword(password: string, passwordConfirm: string, confirmErrors: ValidationErrors = null): { group: ValidationErrors, confirm: ValidationErrors } {
  const otherErrors = { ...(confirmErrors ?? {}) }
  delete otherErrors.matchPassword
  if (password !== passwordConfirm) {
    return { group: { matchPassword: true }, confirm: { ...otherErrors, matchPassword: true } }
  }
  return { group: null, confirm: Object.keys(otherErrors).length ? otherErrors : null }
}

/**
 * Whether a username is taken. Case-insensitive and trimmed - matches the
 * backend, which collides on lower-cased usernames (auth.service.ts addUser /
 * updateUser). A case-sensitive check would let "admin" through when "Admin"
 * already exists, and the form would only surface the collision as a 409 toast
 * after submit.
 * @param value - the username typed
 * @param existingUsers - everyone on the box
 * @param ownId - the user being edited, whose own name does not count against them
 */
export function isDuplicateUsername(value: string, existingUsers: Pick<User, 'id' | 'username'>[], ownId?: number): boolean {
  if (!value) {
    return false
  }
  const trimmedUsername = value.trim().toLowerCase()
  if (!trimmedUsername) {
    return false
  }
  return existingUsers.some(user => (ownId === undefined || user.id !== ownId) && user.username?.toLowerCase() === trimmedUsername)
}

export interface UserFormValue {
  username: string
  name: string
  password: string
  passwordConfirm: string
  admin: boolean
}

export interface UserFormErrors {
  username: ValidationErrors
  name: ValidationErrors
  password: ValidationErrors
  passwordConfirm: ValidationErrors
}

function errors(entries: Record<string, boolean>): ValidationErrors {
  const set = Object.fromEntries(Object.entries(entries).filter(([, on]) => on))
  return Object.keys(set).length ? set : null
}

/**
 * The validators of the add (`passwordRequired`) and edit forms, run over the
 * whole value the way Angular ran the control and group validators.
 * @param value - the form value
 * @param options - which rules apply
 * @param options.existingUsers - for the duplicate username check
 * @param options.ownId - the user being edited
 * @param options.passwordRequired - the add form requires a password and its confirmation
 */
export function validateUserForm(value: UserFormValue, options: { existingUsers: Pick<User, 'id' | 'username'>[], ownId?: number, passwordRequired: boolean }) {
  const { existingUsers, ownId, passwordRequired } = options
  const confirmOwn = errors({ required: passwordRequired && !value.passwordConfirm })
  const match = matchPassword(value.password, value.passwordConfirm, confirmOwn)
  const fieldErrors: UserFormErrors = {
    username: errors({ required: !value.username, duplicateUsername: isDuplicateUsername(value.username, existingUsers, ownId) }),
    name: errors({ required: !value.name }),
    // Validators.minLength skips an empty value; `required` covers that on the add form
    password: errors({ required: passwordRequired && !value.password, minlength: value.password.length > 0 && value.password.length < 4 }),
    passwordConfirm: match.confirm,
  }
  const valid = match.group === null && Object.values(fieldErrors).every(fieldError => fieldError === null)
  return { errors: fieldErrors, valid }
}
