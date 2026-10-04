import { useMemo } from 'react'

import { renderAiMarkdown } from '@/core/ai/ai-markdown'
import { cx } from '@/core/utilities/cx'

/** An answer from the Assistant (`.mp-ai-prose`), rendered from markdown. */
export function AiMarkdown({ text, className }: { text: string, className?: string }) {
  const html = useMemo(() => renderAiMarkdown(text), [text])
  // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml -- raw HTML escaped and sanitised in renderAiMarkdown()
  return <div className={cx('mp-ai-prose', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
