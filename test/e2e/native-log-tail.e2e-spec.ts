import { appendFile, mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { NativeLogTail } from '../../src/modules/log/native-log-tail.js'
import { testStoragePath } from '../storage-path.js'

describe('NativeLogTail', () => {
  const root = resolve(testStoragePath, 'native-log-tail')
  let n = 0
  let tail: NativeLogTail | undefined

  const newLog = async (content: string) => {
    n += 1
    const path = resolve(root, `${n}.log`)
    await writeFile(path, content)
    return path
  }

  const follow = (path: string, position: number) => {
    tail = new NativeLogTail(path)
    const lines: string[] = []
    tail.on('line', line => lines.push(line))
    tail.start(position)
    return lines
  }

  beforeAll(async () => {
    await mkdir(root, { recursive: true })
  })

  afterEach(() => {
    tail?.stop()
    tail = undefined
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('emits only what is appended after the start position, line by line', async () => {
    const path = await newLog('old 1\nold 2\n')
    const lines = follow(path, 12)

    await appendFile(path, 'new 1\r\nnew ')
    await vi.waitFor(() => expect(lines).toEqual(['new 1']), { timeout: 3000, interval: 20 })

    // the partial line is held until its newline arrives
    await appendFile(path, '2\n')
    await vi.waitFor(() => expect(lines).toEqual(['new 1', 'new 2']), { timeout: 3000, interval: 20 })
  })

  it('carries on from the new end of a truncated file', async () => {
    const path = await newLog('a long first line\n')
    const lines = follow(path, 18)

    await truncate(path, 0)
    await appendFile(path, 'kept\n')
    // depending on timing the shrink is seen before or after the write; the
    // next line is always followed
    await new Promise(res => setTimeout(res, 1200))
    await appendFile(path, 'after\n')
    await vi.waitFor(() => expect(lines).toContain('after'), { timeout: 3000, interval: 20 })
    expect(lines).not.toContain('a long first line')
  })

  it('keeps following through the poll when fs.watch is unavailable', async () => {
    const path = await newLog('')
    const lines = follow(path, 0)
    // as on a filesystem where fs.watch never fires
    ;(tail as any).stopFsWatch()
    expect(tail!.usingFsWatch).toBe(false)

    await appendFile(path, 'polled\n')
    await vi.waitFor(() => expect(lines).toEqual(['polled']), { timeout: NativeLogTail.POLL_INTERVAL_MS * 3, interval: 50 })
  })

  it('stops emitting once stopped, and resumes from the given position', async () => {
    const path = await newLog('')
    const lines = follow(path, 0)

    tail!.stop()
    await appendFile(path, 'while stopped\n')
    await new Promise(res => setTimeout(res, NativeLogTail.POLL_INTERVAL_MS + 200))
    expect(lines).toEqual([])

    tail!.start('while stopped\n'.length)
    await appendFile(path, 'resumed\n')
    await vi.waitFor(() => expect(lines).toEqual(['resumed']), { timeout: 3000, interval: 20 })
  })
})
