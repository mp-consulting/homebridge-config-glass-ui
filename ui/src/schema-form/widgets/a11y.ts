/**
 * The accessibility fixes the Angular app applied to ng-formworks' markup
 * after the fact (ui/src/app/core/directives/json-schema-form-patch.directive.ts),
 * as plain functions the React widgets call on their own elements. The rules,
 * texts and marker attributes are the same, so the accessibility tree and
 * any CSS/tests keyed off the markers do not change.
 */

const RE_LEADING_SYMBOLS = /^[\s]+/g
const RE_TRAILING_CLICKABLE = /\s+clickable\s*$/i
const RE_WHITESPACE = /\s+/g

export function cleanSectionTitle(raw: string) {
  let t = (raw || '').replace(RE_LEADING_SYMBOLS, '').trim()
  t = t.replace(RE_TRAILING_CLICKABLE, '').trim()
  if (t.length > 80) {
    t = t.slice(0, 80).trim()
  }
  return t
}

export function hasExplicitA11yName(el: Element): boolean {
  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel && ariaLabel.trim()) {
    return true
  }

  const ariaLabelledby = el.getAttribute('aria-labelledby')
  if (ariaLabelledby && ariaLabelledby.trim()) {
    return true
  }

  const title = el.getAttribute('title')
  return !!(title && title.trim())
}

export function getLabelText(labelEl: Element | null): string {
  if (!labelEl) {
    return ''
  }

  return (labelEl.textContent || '')
    .replace(RE_WHITESPACE, ' ')
    .trim()
}

/** The name of the array item / section a delete button belongs to */
export function findNearestItemName(btn: HTMLElement, root: HTMLElement) {
  const container
    = btn.closest('.list-group-item')
      || btn.closest('.card')
      || btn.closest('li')
      || btn.closest('fieldset')
      || btn.parentElement

  const scope = (container as HTMLElement) || root

  const legend = scope.querySelector('legend') as HTMLElement | null
  if (legend) {
    const t = cleanSectionTitle((legend.textContent || '').trim())
    if (t) {
      return t
    }
  }

  const heading = scope.querySelector('h1, h2, h3, h4, h5, h6') as HTMLElement | null
  if (heading) {
    const t = cleanSectionTitle((heading.textContent || '').trim())
    if (t) {
      return t
    }
  }

  return ''
}

/**
 * `patchDeleteButtons`: an array item's bare `×` button gets a name saying
 * what it deletes, once.
 */
export function labelDeleteButton(button: HTMLButtonElement, root: HTMLElement) {
  if (button.hasAttribute('data-jsf-a11y-delete')) {
    return
  }
  const itemName = findNearestItemName(button, root)
  button.setAttribute('aria-label', itemName ? `Delete ${itemName}` : 'Delete')
  button.removeAttribute('title')
  button.setAttribute('data-jsf-a11y-delete', 'true')
}

/**
 * `patchBasicControlNames`: a text field, select or textarea without an
 * explicit accessible name takes it from its label. Note that, like the
 * directive, a `<label for>` association does not count as a name here.
 */
export function labelBasicControl(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, root: Document | Element) {
  if (control instanceof HTMLInputElement) {
    const type = (control.getAttribute('type') || '').toLowerCase()
    if (type === 'checkbox' || type === 'radio') {
      return
    }
  }

  if (control.hasAttribute('data-jsf-a11y-labeled')) {
    return
  }

  if (hasExplicitA11yName(control)) {
    control.setAttribute('data-jsf-a11y-labeled', 'true')
    return
  }

  let labelText = ''
  if (control.id) {
    let label: HTMLLabelElement | null = null
    try {
      // Control ids are unique, so the label found next to the control is the
      // one a search of the whole form would find. Searching the form for
      // every control is quadratic: seconds on a form with ~900 controls.
      const selector = `label[for="${control.id}"]`
      label = control.closest('css-framework')?.querySelector(selector) ?? root.querySelector(selector)
    } catch {
      label = null
    }
    labelText = (label?.textContent || '').trim()
  }

  if (!labelText) {
    const wrap = control.closest('label') as HTMLLabelElement | null
    labelText = getLabelText(wrap)
  }

  if (!labelText) {
    return
  }

  control.setAttribute('aria-label', labelText)
  control.setAttribute('data-jsf-a11y-labeled', 'true')
}
