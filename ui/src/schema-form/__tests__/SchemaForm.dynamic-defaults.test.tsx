import { beforeEach, describe, expect, it } from 'vitest'

import { click, lastEmitted, renderSchemaForm, settle, typeInto } from './helpers'

/**
 * Port of ui/src/app/core/components/schema-form/schema-form.dynamic-defaults.spec.ts:
 * the `dynamicDefaults` keyword from ajv-keywords (issue #2606). A plugin's
 * config schema can declare `dynamicDefaults: { id: 'uuid' }` and a config
 * that has no `id` gets one generated for it - once, and stable afterwards.
 */
describe('schemaForm dynamicDefaults', () => {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  const schema = {
    type: 'object',
    dynamicDefaults: {
      id: 'uuid',
    },
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
      },
      name: {
        type: 'string',
      },
      port: {
        type: 'integer',
        default: 8080,
      },
    },
  }

  const arraySchema = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
      },
      devices: {
        type: 'array',
        items: {
          type: 'object',
          dynamicDefaults: {
            id: 'uuid',
          },
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            label: {
              type: 'string',
            },
          },
        },
      },
    },
  }

  let form: ReturnType<typeof renderSchemaForm>

  async function create(data: any, useSchema: any = schema) {
    form = renderSchemaForm({ schema: useSchema }, data)
    await settle(0)
  }

  function findInput(property: string): HTMLInputElement {
    const input = form.container.querySelector(`input[name="${property}"]`) as HTMLInputElement | null
    if (!input) {
      throw new Error(`No input rendered for "${property}"`)
    }
    return input
  }

  beforeEach(async () => {
    await create({ name: 'My Plugin' })
  })

  it('generates a uuid for the missing property and shows it in the form', () => {
    expect(findInput('id').value).toMatch(UUID_PATTERN)
  })

  it('emits the generated uuid with the form data, exactly once and unchanged', async () => {
    const generated = findInput('id').value

    await typeInto(findInput('name'), 'Renamed')
    await settle()

    expect(form.emitted.length).toBeGreaterThan(0)
    const data = lastEmitted(form)
    expect(data.name).toBe('Renamed')
    expect(data.id).toBe(generated)

    const occurrences = JSON.stringify(data).split(generated).length - 1
    expect(occurrences).toBe(1)
  })

  it('keeps the same uuid across re-validations instead of regenerating it', async () => {
    const generated = findInput('id').value

    await typeInto(findInput('name'), 'First edit')
    await settle()
    const afterFirst = lastEmitted(form).id

    await typeInto(findInput('name'), 'Second edit')
    await settle()
    const afterSecond = lastEmitted(form).id

    expect(afterFirst).toBe(generated)
    expect(afterSecond).toBe(generated)
    expect(findInput('id').value).toBe(generated)
  })

  it('leaves an existing value alone', async () => {
    const existing = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
    form.unmount()
    await create({ id: existing, name: 'My Plugin' })

    expect(findInput('id').value).toBe(existing)

    await typeInto(findInput('name'), 'Renamed')
    await settle()

    expect(lastEmitted(form).id).toBe(existing)
  })

  describe('inside array items', () => {
    function idInputs(): HTMLInputElement[] {
      return Array.from(form.container.querySelectorAll('input[name="id"]'))
    }

    async function addItem() {
      const button = form.container.querySelector('add-reference-widget button')
      if (!button) {
        throw new Error('No add-item button rendered')
      }
      await click(button)
    }

    beforeEach(async () => {
      form.unmount()
      await create({ name: 'My Plugin', devices: [{ label: 'first' }] }, arraySchema)
    })

    it('generates a uuid for an existing item that is missing one', () => {
      expect(idInputs()).toHaveLength(1)
      expect(idInputs()[0].value).toMatch(UUID_PATTERN)
    })

    it('generates a distinct uuid for an item added through the form', async () => {
      const firstId = idInputs()[0].value

      await addItem()
      await settle()

      const inputs = idInputs()
      expect(inputs).toHaveLength(2)
      expect(inputs[1].value).toMatch(UUID_PATTERN)
      expect(inputs[1].value).not.toBe(firstId)

      const data = lastEmitted(form)
      expect(data.devices).toHaveLength(2)
      expect(data.devices[0].id).toBe(firstId)
      expect(data.devices[1].id).toBe(inputs[1].value)
    })

    it('keeps an added item uuid stable across later edits', async () => {
      await addItem()
      await settle()
      const addedId = idInputs()[1].value

      await typeInto(findInput('name'), 'Renamed')
      await settle()

      expect(idInputs()[1].value).toBe(addedId)
      const data = lastEmitted(form)
      expect(data.devices[1].id).toBe(addedId)
    })
  })

  it('still lets the user clear a field with a static default', async () => {
    // Guards the setSchemaDefaults/returnEmptyFields interaction: the fix must
    // not make validation resurrect ordinary `default` values the user removed
    expect(findInput('port').value).toBe('8080')

    await typeInto(findInput('port'), '')
    await settle()

    const data = lastEmitted(form)
    expect(data).not.toHaveProperty('port')
    expect(data.id).toMatch(UUID_PATTERN)
  })
})
