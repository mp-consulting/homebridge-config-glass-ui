export interface CreateUserValues {
  username: string
  password: string
  passwordConfirm: string
}

type FieldErrors = Record<string, true> | null

export interface CreateUserErrors {
  username: FieldErrors
  password: FieldErrors
  passwordConfirm: FieldErrors
  /** The form-level error: the two passwords differ. */
  form: FieldErrors
}

/**
 * The account form's rules: a username, a password of four or more, and a
 * confirmation that matches. The match error sits on the confirmation next to
 * its own `required`, never instead of it, or the form looks valid while the
 * confirmation is empty.
 * @param values - the form values
 */
export function validateCreateUser(values: CreateUserValues): CreateUserErrors {
  const errorsOf = (entries: Array<[string, boolean]>): FieldErrors => {
    const found = Object.fromEntries(entries.filter(([, failed]) => failed).map(([key]) => [key, true as const]))
    return Object.keys(found).length ? found : null
  }
  const mismatch = values.password !== values.passwordConfirm
  return {
    username: errorsOf([['required', !values.username]]),
    password: errorsOf([['required', !values.password], ['minlength', !!values.password && values.password.length < 4]]),
    passwordConfirm: errorsOf([['required', !values.passwordConfirm], ['matchPassword', mismatch]]),
    form: mismatch ? { matchPassword: true } : null,
  }
}
