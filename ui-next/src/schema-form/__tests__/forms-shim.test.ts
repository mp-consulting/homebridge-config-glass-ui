import { describe, expect, it } from 'vitest'

import { UntypedFormArray, UntypedFormControl, UntypedFormGroup } from '../engine/forms-shim'
import { JsonValidators } from '../engine/json.validators'

/**
 * The @angular/forms semantics the vendored engine depends on. Each case is
 * how Angular's AbstractControl behaves.
 */
describe('forms shim', () => {
  it('unboxes `{ value, disabled }` form state', () => {
    const control = new UntypedFormControl({ value: 'x', disabled: true })

    expect(control.value).toBe('x')
    expect(control.disabled).toBe(true)
    expect(control.status).toBe('DISABLED')
  })

  it('leaves disabled controls out of the value but not the raw value', () => {
    const group = new UntypedFormGroup({
      a: new UntypedFormControl(1),
      b: new UntypedFormControl({ value: 2, disabled: true }),
    })

    expect(group.value).toEqual({ a: 1 })
    expect(group.getRawValue()).toEqual({ a: 1, b: 2 })
  })

  it('propagates a change to the parent unless onlySelf', () => {
    const child = new UntypedFormControl('a')
    const group = new UntypedFormGroup({ child })
    const emitted: any[] = []
    group.valueChanges.subscribe(v => emitted.push(v))

    child.setValue('b')
    child.setValue('c', { onlySelf: true })

    expect(emitted).toEqual([{ child: 'b' }])
    expect(group.value).toEqual({ child: 'b' })
  })

  it('does not emit with emitEvent: false, but still updates', () => {
    const group = new UntypedFormGroup({ child: new UntypedFormControl('a') })
    const emitted: any[] = []
    group.valueChanges.subscribe(v => emitted.push(v))

    group.patchValue({ child: 'b' }, { emitEvent: false })

    expect(emitted).toEqual([])
    expect(group.value).toEqual({ child: 'b' })
  })

  it('emits a group\'s valueChanges once for patchValue, after its children', () => {
    const a = new UntypedFormControl(1)
    const group = new UntypedFormGroup({ a })
    const order: string[] = []
    a.valueChanges.subscribe(() => order.push('a'))
    group.valueChanges.subscribe(() => order.push('group'))

    group.patchValue({ a: 2, unknown: 3 })

    expect(order).toEqual(['a', 'group'])
  })

  it('resets controls to null, groups to {} and arrays to []', () => {
    const group = new UntypedFormGroup({
      name: new UntypedFormControl('x'),
      nested: new UntypedFormGroup({ value: new UntypedFormControl(1) }),
      list: new UntypedFormArray([new UntypedFormControl('a')]),
    })

    group.reset({})

    expect(group.value).toEqual({ name: null, nested: { value: null }, list: [null] })
  })

  it('runs the JsonValidators and rolls validity up to the parent', () => {
    const control = new UntypedFormControl('', [(JsonValidators as any).required()])
    const group = new UntypedFormGroup({ control })

    expect(control.errors).toEqual({ required: true })
    expect(group.status).toBe('INVALID')

    control.setValue('filled')

    expect(control.errors).toBeNull()
    expect(group.valid).toBe(true)
  })

  it('finds controls by dotted path and array index', () => {
    const group = new UntypedFormGroup({
      list: new UntypedFormArray([new UntypedFormGroup({ name: new UntypedFormControl('first') })]),
    })

    expect(group.get('list.0.name')?.value).toBe('first')
    expect(group.get(['list', 0, 'name'])?.value).toBe('first')
    expect(group.get('list.-')).toBeNull()
    expect(group.get('missing')).toBeNull()
  })

  it('keeps a removed array item\'s parent, as Angular does', () => {
    const item = new UntypedFormControl('a')
    const array = new UntypedFormArray([item, new UntypedFormControl('b')])

    array.removeAt(0)

    expect(array.value).toEqual(['b'])
    expect(item.parent).toBe(array)
    // A late write to the removed control re-validates the array without it
    item.setValue('changed')
    expect(array.value).toEqual(['b'])
  })

  it('writes model changes to registered views unless asked not to', () => {
    const control = new UntypedFormControl('a')
    const written: any[] = []
    control.registerOnChange(value => written.push(value))

    control.setValue('b')
    control.setValue('c', { emitModelToViewChange: false })

    expect(written).toEqual(['b'])
  })
})
