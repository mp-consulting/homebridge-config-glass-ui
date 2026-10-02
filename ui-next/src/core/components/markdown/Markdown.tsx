import { useMemo } from 'react'

import { renderMarkdown } from './render-markdown'

/**
 * Renders third-party markdown (plugin changelogs, schema header/footer
 * text): sanitised, links opened in a new tab without an opener, GitHub alert
 * callouts, emoji shortnames. See `renderMarkdown`.
 *
 * The output is already sanitised, so it is set directly rather than through
 * `SafeHtml` (a second pass would change nothing).
 */
export function Markdown({ data = '', className }: { data?: string | null, className?: string }) {
  const html = useMemo(() => renderMarkdown(data), [data])
  // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml -- sanitised inside renderMarkdown()
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
