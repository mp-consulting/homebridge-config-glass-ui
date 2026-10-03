import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveFormLanguage, SCHEMA_FORM_OPTIONS, SchemaFormState } from '../schema-form-state'
import { SchemaForm } from '../SchemaForm'
import { lastEmitted, renderSchemaForm, settle, typeInto } from './helpers'

/**
 * Port of ui/src/app/core/components/schema-form/schema-form.component.spec.ts.
 *
 * The wrapper exists almost entirely to work around how formworks handles
 * data: the form hands back a rebuilt object on every change, so the wrapper
 * keeps the caller's own object identity and merges into it. Two consequences
 * are load-bearing rather than cosmetic: `_bridge` is preserved verbatim, and
 * the emitted object is the SAME reference that was passed in.
 *
 * The rules live in `SchemaFormState`, which these tests drive directly the
 * way the Angular spec called the component's handlers; the rendered form is
 * covered alongside.
 */
describe('schemaForm', () => {
  const nameSchema = { schema: { type: 'object', properties: { name: { type: 'string', title: 'Name' } } } }

  describe('the form language', () => {
    it('uses english by default', () => {
      expect(resolveFormLanguage(undefined)).toBe('en')
      expect(resolveFormLanguage('en')).toBe('en')
    })

    it('uses the language the user chose', () => {
      expect(resolveFormLanguage('de')).toBe('de')
    })

    it('drops the region, because the form only ships base languages', () => {
      expect(resolveFormLanguage('pt-BR')).toBe('pt')
    })

    it('stays on english for a language the form does not ship', () => {
      expect(resolveFormLanguage('uk')).toBe('en')
    })

    it('maps a chinese variant onto the base language it does ship', () => {
      expect(resolveFormLanguage('zh-TW')).toBe('zh')
    })

    it('shows the validation messages in that language', async () => {
      const schema = { schema: { type: 'object', properties: { name: { type: 'string', title: 'Name', minLength: 5 } } } }
      const form = renderSchemaForm(schema, {}, { lang: 'de-AT' })
      await settle(0)
      await typeInto(form.container.querySelector('input[name="name"]')!, 'ab')
      await settle()

      expect(form.container.querySelector('.help-block')?.textContent).toContain('Mindestens 5 Zeichen')
    })
  })

  describe('the form options', () => {
    it('turns off everything that would fight the surrounding modal', () => {
      expect(SCHEMA_FORM_OPTIONS).toEqual({
        addSubmit: false,
        loadExternalAssets: false,
        returnEmptyFields: false,
        setSchemaDefaults: true,
        autocomplete: false,
      })
    })

    it('renders no submit button and turns autocomplete off', async () => {
      const form = renderSchemaForm(nameSchema, { name: 'Example' })
      await settle(0)

      expect(form.container.querySelector('input[type="submit"]')).toBeNull()
      expect(form.container.querySelector('form')?.getAttribute('autocomplete')).toBe('off')
    })

    it('renders nothing without a schema', () => {
      const form = renderSchemaForm({}, { name: 'Example' })

      expect(form.container.innerHTML).toBe('')
    })
  })

  describe('following the data input', () => {
    it('renders the object it was given', async () => {
      const form = renderSchemaForm(nameSchema, { name: 'Front Room' })
      await settle(0)

      expect((form.container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('Front Room')
    })

    it('re-renders when the caller swaps in a different object', async () => {
      const form = renderSchemaForm(nameSchema, { name: 'Front Room' })
      await settle()

      form.rerender({ name: 'Hallway' })
      await settle()

      expect((form.container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('Hallway')
    })

    it('ignores an edit to the same object', async () => {
      // Mutating in place is how the custom plugin UI updates config, and
      // re-rendering on every one of those would reset the form as it is typed
      const data = { name: 'Front Room' }
      const form = renderSchemaForm(nameSchema, data)
      await settle()

      data.name = 'Edited elsewhere'
      form.rerender(data)
      await settle()

      expect((form.container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('Front Room')
    })
  })

  describe('a change made in the form', () => {
    let emitted: any[]
    let changed: any[]
    let validity: boolean[]
    let state: SchemaFormState

    function create(data: any = { name: 'Example' }) {
      emitted = []
      changed = []
      validity = []
      state = new SchemaFormState(() => ({
        dataChange: value => emitted.push(value),
        dataChanged: value => changed.push(value),
        isValid: value => validity.push(value),
      }))
      state.setDataInput(data)
      return state
    }

    beforeEach(() => {
      create()
    })

    it('emits the object the caller passed in, not the rebuilt one', () => {
      const original = state.currentData

      state.onChanges({ name: 'Typed' })

      expect(emitted).toHaveLength(1)
      expect(emitted[0]).toBe(original)
      expect(original.name).toBe('Typed')
    })

    it('emits on both outputs, because callers listen to different ones', () => {
      state.onChanges({ name: 'Typed' })

      expect(changed).toHaveLength(1)
      expect(changed[0]).toBe(state.currentData)
    })

    it('removes a key the user cleared out of the form', () => {
      create({ name: 'Example', legacyOption: true })

      state.onChanges({ name: 'Example' })

      expect(state.currentData).toEqual({ name: 'Example' })
    })

    it('preserves the child bridge block the form does not model', () => {
      const bridge = { username: '0E:11:11:11:11:11', hap: { enabled: false, externalsOnly: true } }
      create({ name: 'Example', _bridge: bridge })

      state.onChanges({ name: 'Example', _bridge: { username: '0E:11:11:11:11:11' } })

      expect(state.currentData._bridge).toBe(bridge)
      expect(state.currentData._bridge.hap).toEqual({ enabled: false, externalsOnly: true })
    })

    it('does not invent a child bridge block the caller never had', () => {
      create({ name: 'Example' })

      state.onChanges({ name: 'Example', _bridge: { username: '0E:11:11:11:11:11' } })

      expect('_bridge' in state.currentData).toBe(false)
    })

    it('does not reset the form while its own change is settling', () => {
      const original = state.currentData
      state.onChanges({ name: 'Typed' })

      expect(state.setDataInput({ name: 'From the server' })).toBe(false)

      expect(state.currentData).toBe(original)
      expect(state.currentData.name).toBe('Typed')
    })

    it('accepts the next external change once its own has settled', async () => {
      state.onChanges({ name: 'Typed' })
      state.setDataInput({ name: 'From the server' })

      await Promise.resolve()
      expect(state.setDataInput({ name: 'And again' })).toBe(true)

      expect(state.currentData).toEqual({ name: 'And again' })
    })

    it('emits the raw form object when there is nothing to merge into', () => {
      create(null)

      state.onChanges({ name: 'Typed' })

      expect(emitted[0]).toEqual({ name: 'Typed' })
    })
  })

  describe('a change made in the rendered form', () => {
    it('emits the caller\'s own object, updated', async () => {
      const data = { name: 'Example' }
      const form = renderSchemaForm(nameSchema, data)
      await settle()

      await typeInto(form.container.querySelector('input[name="name"]')!, 'Typed')
      await settle()

      expect(lastEmitted(form)).toBe(data)
      expect(data.name).toBe('Typed')
    })

    it('keeps the child bridge block through an edit', async () => {
      const bridge = { username: '0E:11:11:11:11:11', hap: { enabled: false, externalsOnly: true } }
      const data = { name: 'Example', _bridge: bridge }
      const form = renderSchemaForm(nameSchema, data)
      await settle()

      await typeInto(form.container.querySelector('input[name="name"]')!, 'Typed')
      await settle()

      expect(lastEmitted(form)._bridge).toBe(bridge)
    })

    it('drops keys the schema does not know, as formworks does', async () => {
      const data = { name: 'Example', unknown: 1 }
      const form = renderSchemaForm(nameSchema, data)
      await settle()

      expect(lastEmitted(form)).toEqual({ name: 'Example' })
    })

    it('behaves the same under React StrictMode', async () => {
      const emitted: any[] = []
      const schema = { schema: { type: 'object', properties: { name: { type: 'string' }, enabled: { type: 'boolean' } } } }
      const { container } = render(
        <StrictMode>
          <SchemaForm configSchema={schema} data={{ name: 'Example' }} onDataChange={value => emitted.push(value)} />
        </StrictMode>,
      )
      await settle()
      await typeInto(container.querySelector('input[name="name"]')!, 'Typed')
      await settle()

      expect(emitted[emitted.length - 1]).toEqual({ name: 'Typed', enabled: false })
    })
  })

  describe('reporting validity', () => {
    let validity: boolean[]
    let state: SchemaFormState

    beforeEach(() => {
      vi.useFakeTimers()
      validity = []
      state = new SchemaFormState(() => ({ isValid: value => validity.push(value) }))
      state.setDataInput({})
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('waits for the form to settle before reporting', () => {
      state.validChange(false)
      expect(validity).toEqual([])

      vi.advanceTimersByTime(50)
      expect(validity).toEqual([false])
    })

    it('reports only the state the form settled on', () => {
      state.validChange(false)
      state.validChange(true)
      state.validChange(false)
      state.validChange(true)
      vi.advanceTimersByTime(50)

      expect(validity).toEqual([true])
    })

    it('does not repeat a state it has already reported', () => {
      state.validChange(true)
      vi.advanceTimersByTime(50)
      state.validChange(true)
      vi.advanceTimersByTime(50)

      expect(validity).toEqual([true])
    })

    it('reports a genuine change back the other way', () => {
      state.validChange(true)
      vi.advanceTimersByTime(50)
      state.validChange(false)
      vi.advanceTimersByTime(50)

      expect(validity).toEqual([true, false])
    })

    it('leaves no validation work scheduled after the form has gone', () => {
      state.validChange(true)
      expect(vi.getTimerCount()).toBe(1)

      state.destroy()

      expect(vi.getTimerCount()).toBe(0)
    })

    it('tells nobody about validity once the form has gone', () => {
      state.validChange(true)
      state.destroy()
      vi.advanceTimersByTime(500)

      expect(validity).toEqual([])
    })
  })

  describe('validity of the rendered form', () => {
    const requiredSchema = { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } }

    it('reports an invalid form, then a valid one once it is filled in', async () => {
      const form = renderSchemaForm(requiredSchema, {})
      await settle()
      expect(form.validity).toEqual([false])

      await typeInto(form.container.querySelector('input[name="name"]')!, 'Filled')
      await settle()

      expect(form.validity).toEqual([false, true])
    })

    it('stops reporting once unmounted', async () => {
      // Validity is reported from a timer: run it on a fake clock, past the
      // point where it would have fired
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const form = renderSchemaForm(requiredSchema, {})
        form.unmount()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500)
        })

        expect(form.validity).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
