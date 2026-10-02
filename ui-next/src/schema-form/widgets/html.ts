import DOMPurify from 'dompurify'

/**
 * What Angular's `[innerHTML]` binding renders for a value. Angular
 * stringifies the value and runs it through its HTML sanitizer; DOMPurify
 * plays that role here (plugin schemas are third-party content).
 */
export function safeHtml(value: unknown): { __html: string } {
  if (value === null || value === undefined) {
    return { __html: '' }
  }
  return { __html: DOMPurify.sanitize(String(value)) }
}

// htmlToText runs on every render of every checkbox and option
const TEXT_CACHE_SIZE = 500
const textCache = new Map<string, string>()

/** The text content of an HTML snippet, as the browser would compute it */
export function htmlToText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  const html = String(value)
  // No markup and no entities: the text is the string itself (DOMPurify
  // returns such a string as is). Most labels and option titles are like this.
  if (!html.includes('<') && !html.includes('&')) {
    return html
  }
  let text = textCache.get(html)
  if (text === undefined) {
    const template = document.createElement('template')
    template.innerHTML = DOMPurify.sanitize(html)
    text = template.content.textContent ?? ''
    if (textCache.size >= TEXT_CACHE_SIZE) {
      textCache.delete(textCache.keys().next().value!)
    }
    textCache.set(html, text)
  }
  return text
}

/**
 * Join class fragments the way Angular combines a static `class`, a `[class]`
 * binding and `[class.name]` toggles: empty fragments are dropped and
 * duplicate names collapse.
 */
export function cx(...parts: Array<string | false | null | undefined | Record<string, unknown>>): string | undefined {
  const names: string[] = []
  for (const part of parts) {
    if (!part) {
      continue
    }
    if (typeof part === 'string') {
      for (const name of part.split(/\s+/)) {
        if (name && !names.includes(name)) {
          names.push(name)
        }
      }
    } else {
      for (const [name, on] of Object.entries(part)) {
        if (on && !names.includes(name)) {
          names.push(name)
        }
      }
    }
  }
  return names.length ? names.join(' ') : undefined
}

/**
 * Angular's `[attr.x]="value"`: the attribute is removed for null/undefined
 * and otherwise set to the stringified value (so `false` becomes "false").
 */
export function attr(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value)
}
