/**
 * A framework-free stand-in for the subset of `@angular/forms` reactive
 * controls (`UntypedFormControl`, `UntypedFormGroup`, `UntypedFormArray`) that
 * the vendored @ng-formworks engine and the React widgets use.
 *
 * The semantics follow Angular 21's `AbstractControl` closely - value
 * recomputation, status calculation, the order of `valueChanges` /
 * `statusChanges` emissions, `onlySelf` / `emitEvent` propagation to the
 * parent, boxed `{ value, disabled }` form state, `reset()` defaults - because
 * the engine's output (what ends up in a plugin's config.json) depends on them.
 */
import { Subject } from 'rxjs'

export type ValidationErrors = Record<string, any>
// The engine's JsonValidators take `(control, invert = false)`; Angular only
// ever passes the control, and so does this shim.
export type ValidatorFn = (control: AbstractControl, invert?: boolean) => ValidationErrors | null
export type ControlStatus = 'VALID' | 'INVALID' | 'PENDING' | 'DISABLED'

interface UpdateOptions {
  onlySelf?: boolean
  emitEvent?: boolean
  emitModelToViewChange?: boolean
  emitViewToModelChange?: boolean
}

export const VALID: ControlStatus = 'VALID'
export const INVALID: ControlStatus = 'INVALID'
export const PENDING: ControlStatus = 'PENDING'
export const DISABLED: ControlStatus = 'DISABLED'

function isPresent(o: unknown): boolean {
  return o != null
}

function mergeErrors(arrayOfErrors: (ValidationErrors | null)[]): ValidationErrors | null {
  let res: ValidationErrors = {}
  arrayOfErrors.forEach((errors) => {
    res = errors != null ? { ...res, ...errors } : res
  })
  return Object.keys(res).length === 0 ? null : res
}

/** Angular's `Validators.compose` */
export function composeValidators(validators: (ValidatorFn | null | undefined)[] | null | undefined): ValidatorFn | null {
  if (!validators) {
    return null
  }
  const presentValidators = validators.filter(isPresent) as ValidatorFn[]
  if (presentValidators.length === 0) {
    return null
  }
  return control => mergeErrors(presentValidators.map(v => v(control)))
}

function coerceToValidator(validator: ValidatorFn | ValidatorFn[] | null | undefined): ValidatorFn | null {
  return Array.isArray(validator) ? composeValidators(validator) : validator || null
}

function isBoxedValue(formState: any): formState is { value: any, disabled: boolean } {
  return typeof formState === 'object'
    && formState !== null
    && Object.keys(formState).length === 2
    && 'value' in formState
    && 'disabled' in formState
}

export abstract class AbstractControl {
  value: any
  status: ControlStatus = VALID
  errors: ValidationErrors | null = null
  pristine = true
  touched = false
  valueChanges!: Subject<any>
  statusChanges!: Subject<ControlStatus>

  private _parent: UntypedFormGroup | UntypedFormArray | null = null
  private _rawValidators: ValidatorFn | ValidatorFn[] | null
  private _composedValidatorFn: ValidatorFn | null
  /** @internal */
  _onCollectionChange = () => {}
  /** @internal */
  _onDisabledChange: ((isDisabled: boolean) => void)[] = []

  constructor(validators: ValidatorFn | ValidatorFn[] | null | undefined) {
    this._rawValidators = validators ?? null
    this._composedValidatorFn = coerceToValidator(this._rawValidators)
  }

  get validator(): ValidatorFn | null {
    return this._composedValidatorFn
  }

  set validator(validatorFn: ValidatorFn | null) {
    this._rawValidators = this._composedValidatorFn = validatorFn
  }

  get parent() {
    return this._parent
  }

  get root(): AbstractControl {
    // eslint-disable-next-line ts/no-this-alias
    let x: AbstractControl = this
    while (x._parent) {
      x = x._parent
    }
    return x
  }

  get valid() {
    return this.status === VALID
  }

  get invalid() {
    return this.status === INVALID
  }

  get pending() {
    return this.status === PENDING
  }

  get disabled() {
    return this.status === DISABLED
  }

  get enabled() {
    return this.status !== DISABLED
  }

  get dirty() {
    return !this.pristine
  }

  get untouched() {
    return !this.touched
  }

  setValidators(validators: ValidatorFn | ValidatorFn[] | null) {
    this._rawValidators = validators
    this._composedValidatorFn = coerceToValidator(validators)
  }

  addValidators(validators: ValidatorFn | ValidatorFn[]) {
    const current = Array.isArray(this._rawValidators) ? this._rawValidators : this._rawValidators ? [this._rawValidators] : []
    const add = Array.isArray(validators) ? validators : [validators]
    this.setValidators([...current, ...add.filter(v => !current.includes(v))])
  }

  clearValidators() {
    this.validator = null
  }

  hasValidator(validator: ValidatorFn) {
    return Array.isArray(this._rawValidators) ? this._rawValidators.includes(validator) : this._rawValidators === validator
  }

  markAsTouched(opts: { onlySelf?: boolean } = {}) {
    this.touched = true
    if (this._parent && !opts.onlySelf) {
      this._parent.markAsTouched(opts)
    }
  }

  markAllAsTouched() {
    this.markAsTouched({ onlySelf: true })
    this._forEachChild(control => control.markAllAsTouched())
  }

  markAsUntouched(opts: { onlySelf?: boolean } = {}) {
    this.touched = false
    this._forEachChild((control) => {
      control.markAsUntouched({ onlySelf: true })
    })
    if (this._parent && !opts.onlySelf) {
      this._parent._updateTouched(opts)
    }
  }

  markAsDirty(opts: { onlySelf?: boolean } = {}) {
    this.pristine = false
    if (this._parent && !opts.onlySelf) {
      this._parent.markAsDirty(opts)
    }
  }

  markAsPristine(opts: { onlySelf?: boolean } = {}) {
    this.pristine = true
    this._forEachChild((control) => {
      control.markAsPristine({ onlySelf: true })
    })
    if (this._parent && !opts.onlySelf) {
      this._parent._updatePristine(opts)
    }
  }

  disable(opts: UpdateOptions = {}) {
    const skipPristineCheck = this._parentMarkedDirty(opts.onlySelf)
    this.status = DISABLED
    this.errors = null
    this._forEachChild((control) => {
      control.disable({ ...opts, onlySelf: true })
    })
    this._updateValue()
    if (opts.emitEvent !== false) {
      this.valueChanges?.next(this.value)
      this.statusChanges?.next(this.status)
    }
    this._updateAncestors({ ...opts, skipPristineCheck })
    this._onDisabledChange.forEach(changeFn => changeFn(true))
  }

  enable(opts: UpdateOptions = {}) {
    const skipPristineCheck = this._parentMarkedDirty(opts.onlySelf)
    this.status = VALID
    this._forEachChild((control) => {
      control.enable({ ...opts, onlySelf: true })
    })
    this.updateValueAndValidity({ onlySelf: true, emitEvent: opts.emitEvent })
    this._updateAncestors({ ...opts, skipPristineCheck })
    this._onDisabledChange.forEach(changeFn => changeFn(false))
  }

  private _updateAncestors(opts: UpdateOptions & { skipPristineCheck?: boolean }) {
    if (this._parent && !opts.onlySelf) {
      this._parent.updateValueAndValidity(opts)
      if (!opts.skipPristineCheck) {
        this._parent._updatePristine()
      }
      this._parent._updateTouched()
    }
  }

  setParent(parent: UntypedFormGroup | UntypedFormArray | null) {
    this._parent = parent
  }

  abstract setValue(value: any, options?: UpdateOptions): void
  abstract patchValue(value: any, options?: UpdateOptions): void
  abstract reset(value?: any, options?: UpdateOptions): void

  getRawValue(): any {
    return this.value
  }

  updateValueAndValidity(opts: UpdateOptions = {}) {
    this._setInitialStatus()
    this._updateValue()
    if (this.enabled) {
      this.errors = this._runValidator()
      this.status = this._calculateStatus()
    }
    if (opts.emitEvent !== false) {
      this.valueChanges?.next(this.value)
      this.statusChanges?.next(this.status)
    }
    if (this._parent && !opts.onlySelf) {
      this._parent.updateValueAndValidity(opts)
    }
  }

  setErrors(errors: ValidationErrors | null, opts: { emitEvent?: boolean } = {}) {
    this.errors = errors
    this._updateControlsErrors(opts.emitEvent !== false)
  }

  get(path: Array<string | number> | string | number | null | undefined): AbstractControl | null {
    let currPath: Array<string | number> | string | number | null | undefined = path
    if (currPath == null) {
      return null
    }
    if (!Array.isArray(currPath)) {
      currPath = String(currPath).split('.')
    }
    if (currPath.length === 0) {
      return null
    }
    return currPath.reduce<AbstractControl | null>((control, name) => control && control._find(name), this)
  }

  getError(errorCode: string, path?: Array<string | number> | string) {
    const control = path ? this.get(path) : this
    return control && control.errors ? control.errors[errorCode] : null
  }

  hasError(errorCode: string, path?: Array<string | number> | string) {
    return !!this.getError(errorCode, path)
  }

  /** @internal */
  _find(_name: string | number): AbstractControl | null {
    return null
  }

  /** @internal */
  _updateControlsErrors(emitEvent: boolean) {
    this.status = this._calculateStatus()
    if (emitEvent) {
      this.statusChanges.next(this.status)
    }
    if (this._parent) {
      this._parent._updateControlsErrors(emitEvent)
    }
  }

  /** @internal */
  _initObservables() {
    this.valueChanges = new Subject<any>()
    this.statusChanges = new Subject<ControlStatus>()
  }

  private _calculateStatus(): ControlStatus {
    if (this._allControlsDisabled()) {
      return DISABLED
    }
    if (this.errors) {
      return INVALID
    }
    if (this._anyControlsHaveStatus(PENDING)) {
      return PENDING
    }
    if (this._anyControlsHaveStatus(INVALID)) {
      return INVALID
    }
    return VALID
  }

  private _setInitialStatus() {
    this.status = this._allControlsDisabled() ? DISABLED : VALID
  }

  private _runValidator() {
    return this.validator ? this.validator(this) : null
  }

  /** @internal */
  _anyControlsHaveStatus(status: ControlStatus) {
    return this._anyControls(control => control.status === status)
  }

  /** @internal */
  _anyControlsDirty() {
    return this._anyControls(control => control.dirty)
  }

  /** @internal */
  _anyControlsTouched() {
    return this._anyControls(control => control.touched)
  }

  /** @internal */
  _updatePristine(opts: { onlySelf?: boolean } = {}) {
    this.pristine = !this._anyControlsDirty()
    if (this._parent && !opts.onlySelf) {
      this._parent._updatePristine(opts)
    }
  }

  /** @internal */
  _updateTouched(opts: { onlySelf?: boolean } = {}) {
    this.touched = this._anyControlsTouched()
    if (this._parent && !opts.onlySelf) {
      this._parent._updateTouched(opts)
    }
  }

  /** @internal */
  _registerOnCollectionChange(fn: () => void) {
    this._onCollectionChange = fn
  }

  private _parentMarkedDirty(onlySelf?: boolean) {
    const parentDirty = this._parent && this._parent.dirty
    return !onlySelf && !!parentDirty && !this._parent!._anyControlsDirty()
  }

  /** @internal */
  abstract _updateValue(): void
  /** @internal */
  abstract _forEachChild(cb: (c: AbstractControl, key: any) => void): void
  /** @internal */
  abstract _anyControls(condition: (c: AbstractControl) => boolean): boolean
  /** @internal */
  abstract _allControlsDisabled(): boolean
}

export class UntypedFormControl extends AbstractControl {
  readonly defaultValue: any = null
  private _onChange: ((value: any, emitModelEvent: boolean) => void)[] = []

  constructor(formState: any = null, validatorOrOpts?: ValidatorFn | ValidatorFn[] | null) {
    super(validatorOrOpts)
    this._applyFormState(formState)
    this._initObservables()
    this.updateValueAndValidity({ onlySelf: true, emitEvent: false })
  }

  setValue(value: any, options: UpdateOptions = {}) {
    this.value = value
    if (this._onChange.length && options.emitModelToViewChange !== false) {
      this._onChange.forEach(changeFn => changeFn(this.value, options.emitViewToModelChange !== false))
    }
    this.updateValueAndValidity(options)
  }

  patchValue(value: any, options: UpdateOptions = {}) {
    this.setValue(value, options)
  }

  reset(formState: any = this.defaultValue, options: UpdateOptions = {}) {
    this._applyFormState(formState)
    this.markAsPristine(options)
    this.markAsUntouched(options)
    this.setValue(this.value, options)
  }

  /** Model -> view listener, as registered by Angular's FormControlDirective */
  registerOnChange(fn: (value: any, emitModelEvent: boolean) => void) {
    this._onChange.push(fn)
    return () => {
      this._onChange = this._onChange.filter(f => f !== fn)
    }
  }

  registerOnDisabledChange(fn: (isDisabled: boolean) => void) {
    this._onDisabledChange.push(fn)
    return () => {
      this._onDisabledChange = this._onDisabledChange.filter(f => f !== fn)
    }
  }

  /** @internal */
  _updateValue() {}

  /** @internal */
  _anyControls(_condition: (c: AbstractControl) => boolean) {
    return false
  }

  /** @internal */
  _allControlsDisabled() {
    return this.disabled
  }

  /** @internal */
  _forEachChild(_cb: (c: AbstractControl, key: any) => void) {}

  private _applyFormState(formState: any) {
    if (isBoxedValue(formState)) {
      this.value = formState.value
      if (formState.disabled) {
        this.disable({ onlySelf: true, emitEvent: false })
      } else {
        this.enable({ onlySelf: true, emitEvent: false })
      }
    } else {
      this.value = formState
    }
  }
}

export class UntypedFormGroup extends AbstractControl {
  controls: Record<string, AbstractControl>

  constructor(controls: Record<string, AbstractControl>, validatorOrOpts?: ValidatorFn | ValidatorFn[] | null) {
    super(validatorOrOpts)
    this.controls = controls
    this._initObservables()
    this._setUpControls()
    this.updateValueAndValidity({ onlySelf: true, emitEvent: false })
  }

  registerControl(name: string, control: AbstractControl) {
    if (this.controls[name]) {
      return this.controls[name]
    }
    this.controls[name] = control
    control.setParent(this)
    control._registerOnCollectionChange(this._onCollectionChange)
    return control
  }

  addControl(name: string, control: AbstractControl, options: { emitEvent?: boolean } = {}) {
    this.registerControl(name, control)
    this.updateValueAndValidity({ emitEvent: options.emitEvent })
    this._onCollectionChange()
  }

  removeControl(name: string, options: { emitEvent?: boolean } = {}) {
    if (this.controls[name]) {
      this.controls[name]._registerOnCollectionChange(() => {})
    }
    delete this.controls[name]
    this.updateValueAndValidity({ emitEvent: options.emitEvent })
    this._onCollectionChange()
  }

  setControl(name: string, control: AbstractControl, options: { emitEvent?: boolean } = {}) {
    if (this.controls[name]) {
      this.controls[name]._registerOnCollectionChange(() => {})
    }
    delete this.controls[name]
    if (control) {
      this.registerControl(name, control)
    }
    this.updateValueAndValidity({ emitEvent: options.emitEvent })
    this._onCollectionChange()
  }

  contains(controlName: string) {
    return Object.hasOwn(this.controls, controlName) && this.controls[controlName].enabled
  }

  setValue(value: Record<string, any>, options: UpdateOptions = {}) {
    this._assertAllValuesPresent(value)
    Object.keys(value).forEach((name) => {
      if (!this.controls[name]) {
        throw new Error(`NG01001: Cannot find form control with name: '${name}'.`)
      }
      this.controls[name].setValue(value[name], { onlySelf: true, emitEvent: options.emitEvent })
    })
    this.updateValueAndValidity(options)
  }

  patchValue(value: Record<string, any>, options: UpdateOptions = {}) {
    if (value == null) {
      return
    }
    Object.keys(value).forEach((name) => {
      const control = this.controls[name]
      if (control) {
        control.patchValue(value[name], { onlySelf: true, emitEvent: options.emitEvent })
      }
    })
    this.updateValueAndValidity(options)
  }

  reset(value: any = {}, options: UpdateOptions = {}) {
    this._forEachChild((control, name) => {
      control.reset(value ? value[name] : null, { onlySelf: true, emitEvent: options.emitEvent })
    })
    this._updatePristine(options)
    this._updateTouched(options)
    this.updateValueAndValidity(options)
  }

  getRawValue(): any {
    const acc: Record<string, any> = {}
    this._forEachChild((control, name) => {
      acc[name] = control.getRawValue()
    })
    return acc
  }

  /** @internal */
  _find(name: string | number) {
    return Object.hasOwn(this.controls, name) ? this.controls[name] : null
  }

  /** @internal */
  _forEachChild(cb: (c: AbstractControl, key: string) => void) {
    Object.keys(this.controls).forEach((key) => {
      const control = this.controls[key]
      if (control) {
        cb(control, key)
      }
    })
  }

  /** @internal */
  _setUpControls() {
    this._forEachChild((control) => {
      control.setParent(this)
      control._registerOnCollectionChange(this._onCollectionChange)
    })
  }

  /** @internal */
  _updateValue() {
    const acc: Record<string, any> = {}
    this._forEachChild((control, name) => {
      if (control.enabled || this.disabled) {
        acc[name] = control.value
      }
    })
    this.value = acc
  }

  /** @internal */
  _anyControls(condition: (c: AbstractControl) => boolean) {
    for (const controlName of Object.keys(this.controls)) {
      const control = this.controls[controlName]
      if (this.contains(controlName) && condition(control)) {
        return true
      }
    }
    return false
  }

  /** @internal */
  _allControlsDisabled() {
    for (const controlName of Object.keys(this.controls)) {
      if (this.controls[controlName].enabled) {
        return false
      }
    }
    return Object.keys(this.controls).length > 0 || this.disabled
  }

  private _assertAllValuesPresent(value: any) {
    this._forEachChild((_, key) => {
      if (value[key] === undefined) {
        throw new Error(`NG01002: Must supply a value for form control with name: '${key}'.`)
      }
    })
  }
}

export class UntypedFormArray extends AbstractControl {
  controls: AbstractControl[]

  constructor(controls: AbstractControl[], validatorOrOpts?: ValidatorFn | ValidatorFn[] | null) {
    super(validatorOrOpts)
    this.controls = controls
    this._initObservables()
    this._setUpControls()
    this.updateValueAndValidity({ onlySelf: true, emitEvent: false })
  }

  at(index: number | string): AbstractControl {
    return this.controls[this._adjustIndex(index) as number]
  }

  push(control: AbstractControl, options: { emitEvent?: boolean } = {}) {
    this.controls.push(control)
    this._registerControl(control)
    this.updateValueAndValidity({ emitEvent: options.emitEvent })
    this._onCollectionChange()
  }

  insert(index: number, control: AbstractControl, options: { emitEvent?: boolean } = {}) {
    this.controls.splice(index, 0, control)
    this._registerControl(control)
    this.updateValueAndValidity({ emitEvent: options.emitEvent })
  }

  removeAt(index: number | string, options: { emitEvent?: boolean } = {}) {
    let adjustedIndex: any = this._adjustIndex(index)
    if (adjustedIndex < 0) {
      adjustedIndex = 0
    }
    if (this.controls[adjustedIndex]) {
      this.controls[adjustedIndex]._registerOnCollectionChange(() => {})
    }
    this.controls.splice(adjustedIndex, 1)
    this.updateValueAndValidity({ emitEvent: options.emitEvent })
  }

  setControl(index: number | string, control: AbstractControl, options: { emitEvent?: boolean } = {}) {
    let adjustedIndex: any = this._adjustIndex(index)
    if (adjustedIndex < 0) {
      adjustedIndex = 0
    }
    if (this.controls[adjustedIndex]) {
      this.controls[adjustedIndex]._registerOnCollectionChange(() => {})
    }
    this.controls.splice(adjustedIndex, 1)
    if (control) {
      this.controls.splice(adjustedIndex, 0, control)
      this._registerControl(control)
    }
    this.updateValueAndValidity({ emitEvent: options.emitEvent })
    this._onCollectionChange()
  }

  get length() {
    return this.controls.length
  }

  setValue(value: any[], options: UpdateOptions = {}) {
    this._forEachChild((_, i) => {
      if (value[i] === undefined) {
        throw new Error(`NG01002: Must supply a value for form control at index: ${i}.`)
      }
    })
    value.forEach((newValue, index) => {
      if (!this.at(index)) {
        throw new Error(`NG01001: Cannot find form control at index: ${index}`)
      }
      this.at(index).setValue(newValue, { onlySelf: true, emitEvent: options.emitEvent })
    })
    this.updateValueAndValidity(options)
  }

  patchValue(value: any[], options: UpdateOptions = {}) {
    if (value == null) {
      return
    }
    value.forEach((newValue, index) => {
      if (this.at(index)) {
        this.at(index).patchValue(newValue, { onlySelf: true, emitEvent: options.emitEvent })
      }
    })
    this.updateValueAndValidity(options)
  }

  reset(value: any = [], options: UpdateOptions = {}) {
    this._forEachChild((control, index) => {
      control.reset(value[index], { onlySelf: true, emitEvent: options.emitEvent })
    })
    this._updatePristine(options)
    this._updateTouched(options)
    this.updateValueAndValidity(options)
  }

  getRawValue(): any[] {
    return this.controls.map(control => control.getRawValue())
  }

  clear(options: { emitEvent?: boolean } = {}) {
    if (this.controls.length < 1) {
      return
    }
    this._forEachChild(control => control._registerOnCollectionChange(() => {}))
    this.controls.splice(0)
    this.updateValueAndValidity({ emitEvent: options.emitEvent })
  }

  /** @internal */
  _find(name: string | number) {
    return this.at(name) ?? null
  }

  private _adjustIndex(index: number | string) {
    return (index as number) < 0 ? (index as number) + this.length : index
  }

  /** @internal */
  _forEachChild(cb: (c: AbstractControl, index: number) => void) {
    this.controls.forEach((control, index) => {
      cb(control, index)
    })
  }

  /** @internal */
  _updateValue() {
    this.value = this.controls.filter(control => control.enabled || this.disabled).map(control => control.value)
  }

  /** @internal */
  _anyControls(condition: (c: AbstractControl) => boolean) {
    return this.controls.some(control => control.enabled && condition(control))
  }

  /** @internal */
  _setUpControls() {
    this._forEachChild(control => this._registerControl(control))
  }

  /** @internal */
  _allControlsDisabled() {
    for (const control of this.controls) {
      if (control.enabled) {
        return false
      }
    }
    return this.controls.length > 0 || this.disabled
  }

  private _registerControl(control: AbstractControl) {
    control.setParent(this)
    control._registerOnCollectionChange(this._onCollectionChange)
  }
}

export const FormControl = UntypedFormControl
export const FormGroup = UntypedFormGroup
export const FormArray = UntypedFormArray
