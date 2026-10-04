import { Marked } from 'marked'

import { escapeHtml } from '@/core/helpers/html.helper'
import { sanitizeHtml } from '@/core/ui/sanitize-html'

/**
 * Markdown from a language model is untrusted: any HTML it writes (a tag, an
 * inline `<img onerror>`) is shown as text, never parsed, and the output still
 * goes through the sanitiser. Links open in a new tab without an opener.
 */
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens)
      const safeHref = /^(?:https?:|mailto:|#|\/)/i.test(href) ? href : '#'
      return `<a href="${escapeHtml(safeHref)}"${title ? ` title="${escapeHtml(title)}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`
    },
    image({ text }) {
      // No remote images: they would load from wherever the model pointed
      return escapeHtml(text)
    },
  },
})

/** Render model-written markdown to sanitised HTML with no raw HTML in it. */
export function renderAiMarkdown(source: string | null | undefined): string {
  return sanitizeHtml(marked.parse(source ?? '', { async: false }) as string)
}
