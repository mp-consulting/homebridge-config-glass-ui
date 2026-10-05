/** Picking the relevant lines out of a log tail (read with the kit's `readLogTail`). */

/** Lines that look like warnings or errors (Homebridge, plugin and Node output). */
export function problemLines(lines: string[]): string[] {
  return lines.filter(line => /\b(?:warn(?:ing)?|error|err!|exception|fail(?:ed|ure)?|unhandled|crash(?:ed)?)\b/i.test(line))
}

/** A Homebridge log line starts with its timestamp; anything else continues the line before (a stack trace). */
const RE_LOG_LINE_START = /^\[\d/

/**
 * The lines that mention any of `needles` (a child bridge's name, plugin or
 * identifier, as Homebridge prefixes its lines), each with the lines that
 * continue it, such as the stack trace of a crash.
 */
export function linesMentioning(lines: string[], needles: string[]): string[] {
  const terms = needles.map(needle => needle.trim().toLowerCase()).filter(Boolean)
  const out: string[] = []
  let following = false
  for (const line of lines) {
    if (terms.some(term => line.toLowerCase().includes(term))) {
      out.push(line)
      following = true
    } else if (following && !RE_LOG_LINE_START.test(line)) {
      out.push(line)
    } else {
      following = false
    }
  }
  return out
}
