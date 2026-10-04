import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'

import { RE_ANSI_COLOUR } from '../../core/regex.constants.js'

/**
 * The last `maxLines` lines of a log file, read from at most its last
 * `maxBytes` bytes, without colour codes. The first (probably partial) line
 * of the window is dropped when the file is longer than the window.
 * @param path - the log file
 * @param maxBytes - how much of the end of the file to read
 * @param maxLines - how many lines to keep
 */
export async function readLogTail(path: string, maxBytes: number, maxLines: number): Promise<string[]> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').replace(RE_ANSI_COLOUR, '').split(/\r?\n/)
    if (size > length) {
      lines.shift()
    }
    return lines.filter(line => line.trim() !== '').slice(-maxLines)
  } finally {
    await handle.close()
  }
}

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
