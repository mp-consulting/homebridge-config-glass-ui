import type { FSWatcher, Stats } from 'node:fs'

import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { unwatchFile, watch, watchFile } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'

const READ_CHUNK_BYTES = 64 * 1024

/**
 * Follows a growing log file and emits each new complete line (`line`), or
 * a read failure (`error`).
 *
 * New data is noticed through fs.watch, so a line normally shows up at once
 * without polling. fs.watch is not reliable everywhere - it never fires on
 * some network and container filesystems, and can fail to start when the
 * host is out of inotify watches - so the file is also stat-polled once a
 * second as a fallback (the `tail` package polled every 200 ms instead).
 * Both triggers run the same serialised read from the last position, so a
 * change seen by both is read once.
 *
 * A file that shrinks (hb-service truncating its log) is followed from its
 * new end, as `tail` did; one that is replaced (rotated) is picked up through
 * the poll, which watches the path rather than the inode.
 */
export class NativeLogTail extends EventEmitter {
  /** The fallback poll interval. */
  static readonly POLL_INTERVAL_MS = 1000
  /** How long to wait before re-watching a file that was renamed or replaced. */
  static readonly REWATCH_DELAY_MS = 1000

  private position = 0
  private active = false
  // Bumped by every start/stop, so a read still in flight from an earlier
  // session neither moves the new session's position nor emits into it
  private session = 0
  private watcher: FSWatcher | null = null
  private rewatchTimer: ReturnType<typeof setTimeout> | null = null
  private reading = false
  private readAgain = false
  private partial = ''
  private decoder = new StringDecoder('utf8')

  constructor(public readonly path: string) {
    super()
  }

  public get isWatching(): boolean {
    return this.active
  }

  /** Whether the fs.watch trigger is up (the poll always is while watching). */
  public get usingFsWatch(): boolean {
    return this.watcher !== null
  }

  /**
   * Start following the file from byte `position` - normally its size when
   * the caller read the existing content. Does nothing while already watching.
   */
  public start(position: number): void {
    if (this.active) {
      return
    }
    this.active = true
    this.session += 1
    this.position = position
    this.partial = ''
    this.decoder = new StringDecoder('utf8')
    this.startFsWatch()
    watchFile(this.path, { interval: NativeLogTail.POLL_INTERVAL_MS, persistent: false }, this.onPoll)
  }

  public stop(): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.session += 1
    this.stopFsWatch()
    unwatchFile(this.path, this.onPoll)
  }

  private onPoll = (curr: Stats, prev: Stats) => {
    if (curr.size !== prev.size || curr.mtimeMs !== prev.mtimeMs || curr.ino !== prev.ino) {
      this.check()
    }
  }

  private startFsWatch(): void {
    try {
      this.watcher = watch(this.path, { persistent: false }, (event) => {
        if (event === 'rename') {
          // The file was moved away or replaced: the watcher is now on the old
          // inode. Watch the path again once the new file is likely in place
          // (the poll covers the gap).
          this.scheduleRewatch()
        }
        this.check()
      })
      this.watcher.on('error', () => this.scheduleRewatch())
    } catch {
      // e.g. ENOSPC (no inotify watches left): the poll alone keeps it going
      this.watcher = null
    }
  }

  private stopFsWatch(): void {
    if (this.rewatchTimer) {
      clearTimeout(this.rewatchTimer)
      this.rewatchTimer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  private scheduleRewatch(): void {
    this.stopFsWatch()
    this.rewatchTimer = setTimeout(() => {
      this.rewatchTimer = null
      if (this.active) {
        this.startFsWatch()
        this.check()
      }
    }, NativeLogTail.REWATCH_DELAY_MS)
    this.rewatchTimer.unref?.()
  }

  /** Read whatever was appended since the last read; one read at a time. */
  public check(): void {
    if (!this.active) {
      return
    }
    if (this.reading) {
      this.readAgain = true
      return
    }
    this.reading = true
    this.readNew()
      .catch((e) => {
        if (this.listenerCount('error') > 0) {
          this.emit('error', e)
        }
      })
      .finally(() => {
        this.reading = false
        if (this.readAgain) {
          this.readAgain = false
          this.check()
        }
      })
  }

  private async readNew(): Promise<void> {
    const session = this.session
    let size: number
    try {
      size = (await stat(this.path)).size
    } catch (e) {
      // Gone for now (being rotated): the poll notices when it is back
      if (e?.code === 'ENOENT') {
        return
      }
      throw e
    }
    if (session !== this.session) {
      return
    }

    if (size < this.position) {
      // Truncated or replaced by a shorter file: carry on from its end
      this.position = size
      this.partial = ''
      return
    }

    if (size === this.position) {
      return
    }

    const handle = await open(this.path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, size - this.position))
      while (this.position < size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - this.position), this.position)
        if (bytesRead === 0 || session !== this.session) {
          break
        }
        this.position += bytesRead
        this.emitLines(this.decoder.write(buffer.subarray(0, bytesRead)))
      }
    } finally {
      await handle.close()
    }
  }

  private emitLines(text: string): void {
    const parts = (this.partial + text).split(/\r?\n/)
    this.partial = parts.pop() ?? ''
    for (const line of parts) {
      this.emit('line', line)
    }
  }
}
