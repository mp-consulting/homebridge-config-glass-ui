import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanSectionTitle, labelBasicControl, labelDeleteButton } from '../widgets/a11y'
import { click, renderSchemaForm, settle } from './helpers'

/**
 * Port of ui/src/app/core/directives/json-schema-form-patch.directive.spec.ts.
 *
 * The Angular app patched ng-formworks' generated markup for accessibility
 * after the fact; the React widgets build the same fixes in. None of it is
 * visible on screen - it is names and roles a screen reader reads out - so it
 * is the easiest thing to break silently.
 *
 * The first block runs the patch rules over the same hand-written fixtures
 * the directive spec used; the second checks the rendered form.
 */
describe('schema-form accessibility', () => {
  function fixture(markup: string) {
    const root = document.createElement('div')
    root.innerHTML = markup
    document.body.appendChild(root)
    return root
  }

  function patchDeleteButtons(root: HTMLElement) {
    root.querySelectorAll<HTMLButtonElement>('button.btn-close').forEach(button => labelDeleteButton(button, root))
  }

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('naming the delete buttons of an array', () => {
    it('says what each button deletes', () => {
      const host = fixture(`
        <div class="list-group-item">
          <legend>Accessory Name</legend>
          <button class="btn-close" title="Delete"></button>
        </div>
      `)
      patchDeleteButtons(host)

      expect(host.querySelector('button.btn-close')?.getAttribute('aria-label')).toBe('Delete Accessory Name')
    })

    it('takes the name from a heading when there is no legend', () => {
      const host = fixture(`
        <div class="card">
          <h4>Second Device</h4>
          <button class="btn-close"></button>
        </div>
      `)
      patchDeleteButtons(host)

      expect(host.querySelector('button.btn-close')?.getAttribute('aria-label')).toBe('Delete Second Device')
    })

    it('prefers the legend over a heading', () => {
      const host = fixture(`
        <fieldset>
          <legend>From The Legend</legend>
          <h4>From The Heading</h4>
          <button class="btn-close"></button>
        </fieldset>
      `)
      patchDeleteButtons(host)

      expect(host.querySelector('button.btn-close')?.getAttribute('aria-label')).toBe('Delete From The Legend')
    })

    it('falls back to a plain Delete when the item has no name', () => {
      const host = fixture('<li><button class="btn-close"></button></li>')
      patchDeleteButtons(host)

      expect(host.querySelector('button.btn-close')?.getAttribute('aria-label')).toBe('Delete')
    })

    it('names each button after its own item, not the first one', () => {
      const host = fixture(`
        <div class="list-group-item"><legend>First</legend><button class="btn-close"></button></div>
        <div class="list-group-item"><legend>Second</legend><button class="btn-close"></button></div>
      `)
      patchDeleteButtons(host)

      const labels = [...host.querySelectorAll('button.btn-close')].map(button => button.getAttribute('aria-label'))
      expect(labels).toEqual(['Delete First', 'Delete Second'])
    })

    it('drops the title, so the name is not read twice', () => {
      const host = fixture(`
        <div class="list-group-item">
          <legend>Accessory Name</legend>
          <button class="btn-close" title="Remove this item"></button>
        </div>
      `)
      patchDeleteButtons(host)

      expect(host.querySelector('button.btn-close')?.hasAttribute('title')).toBe(false)
    })

    it('trims a very long section title rather than reading it all out', () => {
      const host = fixture(`
        <div class="list-group-item">
          <legend>${'A'.repeat(200)}</legend>
          <button class="btn-close"></button>
        </div>
      `)
      patchDeleteButtons(host)

      const label = host.querySelector('button.btn-close')?.getAttribute('aria-label') ?? ''
      expect(label.length).toBeLessThanOrEqual('Delete '.length + 80)
    })

    it('marks a button it has already named, so a re-render does not redo it', () => {
      const host = fixture('<li><legend>First</legend><button class="btn-close"></button></li>')
      patchDeleteButtons(host)
      host.querySelector('legend')!.textContent = 'Renamed'
      patchDeleteButtons(host)

      expect(host.querySelector('button.btn-close')?.getAttribute('data-jsf-a11y-delete')).toBe('true')
      expect(host.querySelector('button.btn-close')?.getAttribute('aria-label')).toBe('Delete First')
    })
  })

  describe('naming text fields', () => {
    it('also names a text field from its label', () => {
      // Not a no-op: a `<label for>` association is NOT treated as an
      // explicit name, so the text gets copied onto the control as well
      const host = fixture(`
        <input type="text" id="name-1">
        <label for="name-1">Name</label>
      `)
      labelBasicControl(host.querySelector('input')!, host)

      expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Name')
    })

    it('leaves a text field with a name the author set alone', () => {
      const host = fixture(`
        <input type="text" id="name-2" aria-label="Set by the plugin">
        <label for="name-2">Name</label>
      `)
      labelBasicControl(host.querySelector('input')!, host)

      expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Set by the plugin')
    })

    it('leaves an unlabelled text field alone rather than inventing a name', () => {
      const host = fixture('<input type="text">')
      labelBasicControl(host.querySelector('input')!, host)

      expect(host.querySelector('input')?.hasAttribute('aria-label')).toBe(false)
    })

    it('leaves checkboxes to the checkbox rules', () => {
      const host = fixture('<input type="checkbox" id="c"><label for="c">Enabled</label>')
      labelBasicControl(host.querySelector('input')!, host)

      expect(host.querySelector('input')?.hasAttribute('aria-label')).toBe(false)
    })
  })

  describe('cleaning section titles', () => {
    it('drops leading icon glyphs and a trailing "clickable"', () => {
      expect(cleanSectionTitle('  Advanced  clickable')).toBe('Advanced')
    })
  })

  describe('the rendered form', () => {
    it('names a text field after its label, required asterisk included', async () => {
      const form = renderSchemaForm({ schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', title: 'Name' } } } }, {})
      await settle(0)

      const input = form.container.querySelector('input[name="name"]')!
      expect(input.getAttribute('aria-label')).toBe('Name*')
      expect(input.getAttribute('data-jsf-a11y-labeled')).toBe('true')
    })

    it('gives a switch the label text as its name and hides the duplicates', async () => {
      const form = renderSchemaForm({ schema: { type: 'object', properties: { debug: { type: 'boolean', title: 'Enable Debug Mode' } } } }, {})
      await settle(0)

      const input = form.container.querySelector('input[type="checkbox"]')!
      expect(input.getAttribute('aria-label')).toBe('Enable Debug Mode')
      expect(input.getAttribute('data-jsf-a11y-processed')).toBe('true')
      const label = input.closest('label')!
      expect(label.className).toBe('hb-uix-switch')
      const [title, slider] = Array.from(label.querySelectorAll('span'))
      expect(title.getAttribute('aria-hidden')).toBe('true')
      expect(slider.className).toBe('hb-uix-slider hb-uix-round')
      expect(slider.getAttribute('aria-hidden')).toBe('true')
      expect(slider.getAttribute('data-jsf-a11y-hidden')).toBe('true')
    })

    it('names each radio button after its option', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] } } },
        layout: [{ key: 'mode', type: 'radios', titleMap: [{ value: 'a', name: 'Option One' }, { value: 'b', name: 'Option Two' }] }],
      }, {})
      await settle(0)

      const labels = Array.from(form.container.querySelectorAll('input[type="radio"]')).map(radio => radio.getAttribute('aria-label'))
      expect(labels).toEqual(['Option One', 'Option Two'])
    })

    it('names an array item delete button after the item, including a row added later', async () => {
      const schema = {
        schema: {
          type: 'object',
          properties: {
            accessories: {
              type: 'array',
              items: { type: 'object', properties: { name: { type: 'string', title: 'Name' } } },
            },
          },
        },
        layout: [{
          key: 'accessories',
          type: 'array',
          items: [{ type: 'fieldset', title: 'Accessory', items: ['accessories[].name'] }],
        }],
      }
      const form = renderSchemaForm(schema, { accessories: [{ name: 'One' }] })
      await settle()

      await click(form.container.querySelector('add-reference-widget button')!)
      await settle()

      const buttons = Array.from(form.container.querySelectorAll('button.btn-close'))
      expect(buttons.length).toBeGreaterThanOrEqual(2)
      for (const button of buttons) {
        expect(button.getAttribute('aria-label')).toBe('Delete Accessory')
        expect(button.getAttribute('data-jsf-a11y-delete')).toBe('true')
      }
      // The Add button is an ordinary button
      expect(form.container.querySelector('add-reference-widget button')?.hasAttribute('aria-label')).toBe(false)
    })

    it('puts a disclosure button in front of an expandable section', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', properties: { host: { type: 'string', title: 'Host' } } },
        layout: [{ type: 'section', title: 'Advanced', expandable: true, items: ['host'] }],
      }, {})
      await settle(0)

      const container = form.container.querySelector('section-widget > div')!
      const proxy = container.firstElementChild as HTMLButtonElement
      expect(proxy.matches('button.jsf-section-proxy.visually-hidden-focusable')).toBe(true)
      expect(proxy.textContent).toBe('Advanced')
      expect(proxy.getAttribute('aria-label')).toBe('Advanced')
      expect(proxy.getAttribute('aria-expanded')).toBe('false')
      expect(container.getAttribute('role')).toBe('presentation')
      expect(container.querySelector(':scope > label.legend')?.getAttribute('aria-hidden')).toBe('true')
      const body = container.querySelector(':scope > root-widget') as HTMLElement
      expect(proxy.getAttribute('aria-controls')).toBe(body.id)
      expect(body.style.display).toBe('none')
      expect(container.classList.contains('expandable')).toBe(true)

      await click(proxy)

      expect(proxy.getAttribute('aria-expanded')).toBe('true')
      expect(body.style.display).toBe('')
      expect(container.classList.contains('expanded')).toBe(true)
    })

    it('leaves a plain (not expandable) section alone', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', properties: { host: { type: 'string', title: 'Host' } } },
        layout: [{ type: 'section', title: 'Connection', items: ['host'] }],
      }, {})
      await settle(0)

      expect(form.container.querySelector('button.jsf-section-proxy')).toBeNull()
    })

    it('puts a disclosure button first in a fieldset with a legend', async () => {
      const form = renderSchemaForm({
        schema: { type: 'object', properties: { host: { type: 'string', title: 'Host' } } },
        layout: [{ type: 'fieldset', title: 'Connection', expandable: true, items: ['host'] }],
      }, {})
      await settle(0)

      const fieldset = form.container.querySelector('fieldset')!
      const proxy = fieldset.firstElementChild as HTMLButtonElement
      expect(proxy.matches('button.jsf-fieldset-proxy')).toBe(true)
      expect(proxy.getAttribute('aria-label')).toBe('Connection')
      expect(fieldset.getAttribute('role')).toBe('presentation')
      expect(fieldset.querySelector('legend')?.getAttribute('aria-hidden')).toBe('true')

      expect(fieldset.classList.contains('expandable')).toBe(true)
      expect(proxy.getAttribute('aria-expanded')).toBe('false')

      await click(proxy)
      expect(fieldset.classList.contains('expanded')).toBe(true)
      expect(proxy.getAttribute('aria-expanded')).toBe('true')
    })
  })
})
