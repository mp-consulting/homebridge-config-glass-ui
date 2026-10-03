/* global NodeJS */
/* eslint-disable no-console */
import type { WriteStream } from 'node:fs'

import type { Logger } from '../logger.js'

import { Buffer } from 'node:buffer'
import { createReadStream, existsSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import process from 'node:process'

import { pathExists } from 'fs-extra/esm'
import { Tail } from 'tail'

/** How much of the end of the log `logs` / `view` print before following it */
const LOG_TAIL_BYTES = 200000

/**
 * The log size limits from the UI platform block of config.json: truncate
 * once the log reaches `maxSize` bytes (never when negative), keeping the
 * last `truncateSize` bytes.
 */
export function logTruncationLimits(config: any): { maxSize: number, truncateSize: number } {
  const uiConfigBlock = config.platforms?.find((x: any) => x.platform === 'config')
  return {
    maxSize: uiConfigBlock?.log?.maxSize ?? 1000000, // ~1 MB
    truncateSize: uiConfigBlock?.log?.truncateSize ?? 200000, // ~0.2 MB
  }
}

/**
 * Truncate the log file to prevent large log files
 */
export async function truncateLog(
  logPath: string,
  { readConfig, logFile, logger }: { readConfig: () => Promise<any>, logFile?: WriteStream | NodeJS.WriteStream, logger: Logger },
) {
  if (!(await pathExists(logPath))) {
    return
  }

  try {
    const { maxSize, truncateSize } = logTruncationLimits(await readConfig())

    if (maxSize < 0) {
      return
    }

    const logStats = await stat(logPath)

    if (logStats.size < maxSize) {
      return // log file does not need truncating
    }

    // Read out the last `truncatedSize` bytes to a buffer
    const logStartPosition = logStats.size - truncateSize
    const logBuffer = Buffer.alloc(truncateSize)
    const logFileHandle = await open(logPath, 'a+')

    // Cork the WriteStream `logFile` (the FD that process.stdout /
    // process.stderr are routed through) so concurrent log lines
    // don't interleave with the truncate-then-rewrite sequence.
    // Without the cork, lines emitted between truncate() and the
    // final write() land out of order — and on some filesystems
    // leave sparse \0 bytes between the truncated tail and the new
    // content.
    const corked = logFile && typeof (logFile as any).cork === 'function'
    if (corked) {
      (logFile as any).cork()
    }
    try {
      await logFileHandle.read(logBuffer, 0, truncateSize, logStartPosition)
      await logFileHandle.truncate()
      await logFileHandle.write(logBuffer)
    } finally {
      await logFileHandle.close()
      if (corked) {
        (logFile as any).uncork()
      }
    }
  } catch (e) {
    logger.error(`Failed to truncate log file: ${e.message}.`)
  }
}

/**
 * Print the end of the log, then follow it. Exits when there is no log.
 */
async function printAndFollowLog(logPath: string, logger: Logger): Promise<Tail> {
  if (!existsSync(logPath)) {
    logger.error(`Log file does not exist at expected location: ${logPath}.`)
    process.exit(1)
  }

  const logStats = await stat(logPath)
  const logStartPosition = logStats.size <= LOG_TAIL_BYTES ? 0 : logStats.size - LOG_TAIL_BYTES
  const logStream = createReadStream(logPath, { start: logStartPosition })

  logStream.on('data', (buffer) => {
    process.stdout.write(buffer)
  })

  logStream.on('end', () => {
    logStream.close()
  })

  const tail = new Tail(logPath, {
    fromBeginning: false,
    useWatchFile: true,
    fsWatchOptions: {
      interval: 200,
    },
  })

  tail.on('line', console.log)
  return tail
}

/**
 * Tails the Homebridge service log and outputs the results to the console
 */
export async function tailLogs(logPath: string, logger: Logger) {
  await printAndFollowLog(logPath, logger)
}

/**
 * Tails the Homebridge service log for `durationMs` and outputs the results to the console
 */
export async function viewLogs(logPath: string, logger: Logger, durationMs = 30000) {
  const tail = await printAndFollowLog(logPath, logger)

  setTimeout(() => {
    tail.unwatch()
  }, durationMs)
}
