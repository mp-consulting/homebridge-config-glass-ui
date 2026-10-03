import { describe, expect, it, vi } from 'vitest'

import { fixNestedArrayLayout, installFixArrays } from '../engine/fix-arrays'
import { changeSelect, click, lastEmitted, renderSchemaForm, settle, typeInto } from './helpers'

/**
 * Behaviour of the widget layer that plugins rely on: the markup and classes
 * of the patched Bootstrap 5 framework, conditions, arrays, and the data each
 * widget writes back.
 */
describe('schema-form widgets', () => {
  describe('markup', () => {
    it('renders a text field the way the Bootstrap 5 framework did', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', title: 'Name', description: 'Shown in the Home app' } } },
      }, { name: 'Lamp' })
      await settle(0)

      const group = form.container.querySelector('css-framework > div')!
      expect(group.className).toBe('schema-form-text form-group')
      expect(group.getAttribute('data-bs-theme')).toBe('bootstrap5_default')
      const label = group.querySelector(':scope > label')!
      expect(label.className).toBe('control-label')
      // The patched asterisk has no space in front of it
      expect(label.innerHTML).toBe('Name<strong class="text-danger">*</strong>')
      const input = group.querySelector('input-widget input') as HTMLInputElement
      expect(input.classList.contains('form-control')).toBe(true)
      expect(input.id).toBe(label.getAttribute('for'))
      expect(group.querySelector('p')?.className).toBe('help-block grey-text small')
      expect(group.querySelector('p')?.textContent).toBe('Shown in the Home app')
    })

    it('renders a boolean as the homebridge switch', async () => {
      const form = renderSchemaForm({ schema: { type: 'object', properties: { enabled: { type: 'boolean', title: 'Enabled' } } } }, {})
      await settle(0)

      const label = form.container.querySelector('checkbox-widget > label')!
      expect(label.className).toBe('hb-uix-switch')
      expect(label.querySelector('input')?.className).toContain('form-check-input')
      expect(label.lastElementChild?.className).toBe('hb-uix-slider hb-uix-round')
      // The switch has no separate framework label
      expect(form.container.querySelector('css-framework > div > label')).toBeNull()
    })

    it('gives selects Angular\'s `<id>: <value>` option values, with an empty choice unless required', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', required: ['level'], properties: { mode: { type: 'string', enum: ['auto', 'manual'] }, level: { type: 'integer', enum: [1, 2] } } },
      }, {})
      await settle(0)

      const [mode, level] = Array.from(form.container.querySelectorAll('select'))
      expect(mode.className).toContain('form-select')
      expect(Array.from(mode.options).map(o => o.value)).toEqual(['0: null', '1: auto', '2: manual'])
      expect(Array.from(level.options).map(o => o.value)).toEqual(['0: 1', '1: 2'])
    })

    it('renders arrays as a list group with a primary add button', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', properties: { names: { type: 'array', title: 'Names', items: { type: 'string', title: 'Name' } } } },
        layout: [{ key: 'names', type: 'array', buttonText: 'Add a name', items: ['names[]'] }],
      }, { names: ['one'] })
      await settle(0)

      const array = form.container.querySelector('.schema-form-array')!
      expect(array.className).toBe('schema-form-array list-group list-group-hb')
      expect(array.querySelector('fieldset > legend')?.textContent).toBe('Names')
      expect(form.container.querySelector('.list-group-item.list-group-item-hb')).not.toBeNull()
      const add = form.container.querySelector('add-reference-widget button')!
      expect(add.className).toBe('btn btn-primary')
      expect(add.textContent).toBe('Add a name')
      expect(form.container.querySelector('button.btn-close')?.className).toBe('btn-close float-end')
    })

    it('marks an expandable section for the Font Awesome chevrons', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', properties: { host: { type: 'string' } } },
        layout: [{ type: 'fieldset', title: 'Advanced', expandable: true, items: ['host'] }],
      }, {})
      await settle(0)

      const fieldset = form.container.querySelector('fieldset')!
      expect(fieldset.classList.contains('expandable')).toBe(true)
      expect(fieldset.querySelector('legend')?.className).toBe('legend')

      await click(fieldset.querySelector('legend')!)
      expect(fieldset.classList.contains('expanded')).toBe(true)
    })
  })

  describe('data', () => {
    it('writes an unset checkbox as false', async () => {
      const form = renderSchemaForm({ schema: { type: 'object', properties: { enabled: { type: 'boolean' } } } }, {})
      await settle()

      expect(lastEmitted(form)).toEqual({ enabled: false })
    })

    it('fills in schema defaults and converts typed numbers', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', properties: { port: { type: 'integer', default: 8080 }, name: { type: 'string' } } },
      }, {})
      await settle()
      expect(lastEmitted(form)).toEqual({ port: 8080 })

      await typeInto(form.container.querySelector('input[name="port"]')!, '51826')
      await settle()

      expect(lastEmitted(form)).toEqual({ port: 51826 })
    })

    it('shows a field once its condition holds, and drops its value when it is hidden again', async () => {
      const form = renderSchemaForm({
        schema: {
          type: 'object',
          properties: {
            advanced: { type: 'boolean', title: 'Advanced' },
            host: { type: 'string', title: 'Host', condition: { functionBody: 'return model.advanced === true' } },
          },
        },
      }, { advanced: true, host: 'example.local' })
      await settle()
      expect(form.container.querySelector('input[name="host"]')).not.toBeNull()
      expect(lastEmitted(form)).toEqual({ advanced: true, host: 'example.local' })

      await click(form.container.querySelector('input[type="checkbox"]')!)
      await settle(200)

      expect(form.container.querySelector('input[name="host"]')).toBeNull()
      expect(lastEmitted(form)).toEqual({ advanced: false })
    })

    it('reports a plugin-written condition functionBody once, naming the schema and path', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const body = 'return model.flag === \'warn-once\''
        const schema = {
          type: 'object',
          title: 'Warn Once Platform',
          properties: {
            flag: { type: 'string' },
            extra: { type: 'string', title: 'Extra', condition: { functionBody: body } },
          },
        }
        const form = renderSchemaForm({ schema }, { flag: 'warn-once' })
        await settle()
        await typeInto(form.container.querySelector('input[name="flag"]')!, 'warn-once!')
        await settle(200)

        const calls = warn.mock.calls.filter(call => call[1] === body)
        expect(calls).toHaveLength(1)
        expect(String(calls[0][0])).toContain('Warn Once Platform')
        expect(String(calls[0][0])).toContain('/extra')
      } finally {
        warn.mockRestore()
      }
    })

    it('evaluates null-safe conditions inside array items', async () => {
      const form = renderSchemaForm({
        schema: {
          type: 'object',
          properties: {
            devices: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['light', 'fan'] },
                  speed: { type: 'integer', title: 'Speed', condition: { functionBody: 'return model.devices[arrayIndices].type === \'fan\'' } },
                },
              },
            },
          },
        },
      }, { devices: [{ type: 'light' }, { type: 'fan', speed: 3 }] })
      await settle()

      expect(form.container.querySelectorAll('input[name="speed"]')).toHaveLength(1)
      expect(lastEmitted(form)).toEqual({ devices: [{ type: 'light' }, { type: 'fan', speed: 3 }] })
    })

    it('turns the select\'s "null" string into a real null', async () => {
      const form = renderSchemaForm({ schema: { type: 'object', properties: { mode: { type: 'string', enum: ['null', 'auto'] } } } }, { mode: 'auto' })
      await settle()
      expect(lastEmitted(form)).toEqual({ mode: 'auto' })

      await changeSelect(form.container.querySelector('select')!, '0: null')
      await settle()

      expect(lastEmitted(form)).toEqual({})
    })

    it('adds and removes array items', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string', default: 'new' } } } },
      }, { names: ['one'] })
      await settle()
      expect(lastEmitted(form)).toEqual({ names: ['one'] })

      await click(form.container.querySelector('add-reference-widget button')!)
      await settle()
      expect(lastEmitted(form)).toEqual({ names: ['one', 'new'] })

      await click(form.container.querySelectorAll('button.btn-close')[0])
      await settle()
      expect(lastEmitted(form)).toEqual({ names: ['new'] })
    })

    it('resets the values, not the whole form, when the caller passes data of the same shape', async () => {
      const schema = { schema: { type: 'object', properties: { name: { type: 'string' }, port: { type: 'integer' } } } }
      const form = renderSchemaForm(schema, { name: 'One', port: 1 })
      await settle()

      form.rerender({ name: 'Two' })
      await settle()

      expect((form.container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('Two')
      expect((form.container.querySelector('input[name="port"]') as HTMLInputElement).value).toBe('')
      expect(lastEmitted(form)).toEqual({ name: 'Two' })
    })
  })

  describe('tabs', () => {
    it('shows one array item per tab and switches between them', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', properties: { devices: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', title: 'Name' }, host: { type: 'string', title: 'Host' } } } } } },
        layout: [{ key: 'devices', type: 'tabarray', title: '{{ value.name || \'New device\' }}', items: ['devices[].name', 'devices[].host'] }],
      }, { devices: [{ name: 'First' }, { name: 'Second' }] })
      await settle()

      const tabs = Array.from(form.container.querySelectorAll('tabs-widget > ul > li > a'))
      expect(form.container.querySelector('tabs-widget > ul')?.className).toBe('nav nav-tabs')
      expect(tabs.map(tab => tab.textContent?.trim())).toEqual(['First', 'Second', 'Add New device'])
      const panels = Array.from(form.container.querySelectorAll('tabs-widget > div'))
      expect(panels[0].classList.contains('ngf-hidden')).toBe(false)
      expect(panels[1].classList.contains('ngf-hidden')).toBe(true)

      await click(tabs[1])
      expect(panels[0].classList.contains('ngf-hidden')).toBe(true)
      expect(panels[1].classList.contains('ngf-hidden')).toBe(false)
    })
  })

  describe('fixArrays', () => {
    const template = { type: 'section', dataPointer: '/items/-', arrayItem: true, items: [] }
    const ref = { type: '$ref', dataPointer: '/items/-', $ref: '/items/-', arrayItem: true }

    it('adds a layout item for every entry the data holds', () => {
      const layout = [{ type: 'array', dataType: 'array', name: 'items', items: [structuredClone(template), structuredClone(ref)] }]

      fixNestedArrayLayout(layout, { items: [{}, {}, {}] })

      expect(layout[0].items).toHaveLength(4)
      expect(layout[0].items[3].type).toBe('$ref')
    })

    it('leaves the child bridge block alone', () => {
      const layout = [{ type: 'array', dataType: 'array', name: '_bridge', items: [structuredClone(template), structuredClone(ref)] }]

      fixNestedArrayLayout(layout, { items: [{}, {}, {}] })

      expect(layout[0].items).toHaveLength(2)
    })

    it('only repairs the layout when the schema asks for it', () => {
      let enabled = false
      const jsf: any = {
        formValues: { items: [{}, {}] },
        layout: [] as any[],
        buildLayout() {
          this.layout = [{ type: 'array', dataType: 'array', name: 'items', items: [structuredClone(template), structuredClone(ref)] }]
        },
      }
      installFixArrays(jsf, () => enabled)

      jsf.buildLayout({})
      expect(jsf.layout[0].items).toHaveLength(2)

      enabled = true
      jsf.buildLayout({})
      expect(jsf.layout[0].items).toHaveLength(3)
    })
  })
})
