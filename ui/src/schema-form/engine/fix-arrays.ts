/**
 * Port of the `fixArrays` half of `JsonSchemaFormPatchDirective`
 * (ui/src/app/core/directives/json-schema-form-patch.directive.ts).
 *
 * ng-formworks builds too few layout items for nested arrays of `$ref` items
 * when the data already holds several entries. Plugins opt into this repair
 * with `fixArrays: true` in their config schema; it re-inflates the layout
 * from the form values right after `buildLayout()`.
 */
import { cloneDeep, merge, uniqueId } from 'lodash-es'

const RE_SLASH = /\//

/**
 * Wrap `jsf.buildLayout` the way the Angular directive did. `enabled` is read
 * on every call, like the directive's `jsfPatch()` signal.
 */
export function installFixArrays(jsf: any, enabled: () => boolean) {
  const buildLayoutOriginal = jsf.buildLayout.bind(jsf)
  jsf.buildLayout = (widgetLibrary: any) => {
    buildLayoutOriginal(widgetLibrary)
    if (jsf.formValues && enabled()) {
      return fixNestedArrayLayout(jsf.layout, jsf.formValues)
    }
    return jsf.layout
  }
}

export function fixNestedArrayLayout(builtLayout: any[], formData: any) {
  fixArray(builtLayout, formData, '')
  return builtLayout
}

function fixArray(items: any, formData: any, refPointer: string) {
  if (Array.isArray(items)) {
    const configItems = items.filter((x: any) => x.name !== '_bridge')
    const nestedItems = configItems
      .filter((x: any) => x.items && Array.isArray(x.items))
      .flatMap((x: any) => x.items)
      .filter((x: any) => x.dataType === 'array' || x.arrayItem)

    const allItems = [...configItems, ...nestedItems]
    allItems.filter((x: any) => x.dataType === 'array' || x.arrayItem).forEach((item: any) => {
      fixNestedArray(item, formData, refPointer)
    })
  } else {
    fixNestedArray(items, formData, refPointer)
  }
}

function fixNestedArray(item: any, formData: any, refPointer: string) {
  if (item.items && Array.isArray(item.items)) {
    const ref = item.items.find((x: any) => x.type === '$ref')
    if (ref) {
      const dataItems = item.items.filter((x: any) => x.type === 'section' || x.type === 'div')

      const template = dataItems.length > 0
        ? dataItems.reduce((a: any, b: any) => a.id > b.id ? a : b)
        : getItemTemplateFromRef(ref)

      const data = getDataFromPointer(formData, ref.dataPointer.replace(refPointer, ''))

      if (data === null) {
        return
      }

      if (Array.isArray(data)) {
        // Add missing items
        while (item.items.length - 1 < data.length) {
          const newItem = cloneDeep(template)
          newItem._id = uniqueId('new_')

          item.items.unshift(newItem)
        }

        data.forEach((d: any, index: number) => {
          fixArray(item.items[index], d, ref.dataPointer)
        })
      } else {
        fixArray(item.items, formData, ref.dataPointer)
      }
    } else {
      fixArray(item.items, formData, refPointer)
    }

    item.items.filter((i: any) => i.items && Array.isArray(i.items)).forEach((i: any) => {
      fixArray(i.items, formData, refPointer)
    })
  }
}

function getDataFromPointer(data: any, dataPointer: string) {
  let value = data

  dataPointer.substring(1).split(RE_SLASH).filter(x => x !== '-').forEach((key: string) => {
    try {
      value = value[key]
    } catch {
      value = null
    }
  })

  return value
}

function getItemTemplateFromRef(ref: any) {
  const templateNode: { type: string, items: any[] } = {
    type: 'section',
    items: [],
  }

  const item = cloneDeep(ref)
  merge(item, templateNode)
  return item
}
