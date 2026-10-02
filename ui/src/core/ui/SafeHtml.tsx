import type { HTMLAttributes } from 'react'

import { innerHtml } from '@/core/ui/sanitize-html'

type SafeHtmlProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'dangerouslySetInnerHTML'> & {
  /** The element to render; a `div` unless told otherwise. */
  as?: 'div' | 'p' | 'span' | 'h5' | 'li' | 'small'
  html: string | null | undefined
}

/**
 * An element bound to sanitised markup: the React form of the Angular
 * templates' `[innerHTML]="…"`, which sanitised its value. Use this rather
 * than `dangerouslySetInnerHTML` directly, so nothing reaches the DOM
 * unsanitised.
 */
export function SafeHtml({ as: Tag = 'div', html, ...rest }: SafeHtmlProps) {
  // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml -- sanitised by innerHtml(), like Angular's [innerHTML]
  return <Tag {...rest} dangerouslySetInnerHTML={innerHtml(html)} />
}
