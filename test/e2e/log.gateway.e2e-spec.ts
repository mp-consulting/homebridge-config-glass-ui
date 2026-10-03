import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { EventEmitter } from 'node:events'
import { platform } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { green, red, yellow } from 'bash-color'
import { appendFile, copy, writeFile } from 'fs-extra'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigService } from '../../src/core/config/config.service.js'
import { NodePtyService } from '../../src/core/node-pty/node-pty.service.js'
import { LogGateway } from '../../src/modules/log/log.gateway.js'
import { LogModule } from '../../src/modules/log/log.module.js'
import { LOG_HISTORY_MAX_CHARS, LOG_HISTORY_MAX_LINES, LogService, trimLogHistory } from '../../src/modules/log/log.service.js'
import { testStoragePath } from '../storage-path.js'
import { authorizeWsClient } from '../ws-client.js'

describe('LogGateway (e2e)', () => {
  let app: NestFastifyApplication

  let authFilePath: string
  let secretsFilePath: string
  let logFilePath: string

  let configService: ConfigService
  let logGateway: LogGateway
  let logService: LogService
  let nodePtyService: NodePtyService
  let client: EventEmitter

  const size = { cols: 80, rows: 24 }

  /**
   * Wait for the tailed log lines to reach the client.
   *
   * These tests spawn a real process (`tail`, or PowerShell's `Get-Content -Wait`)
   * and its first output is its own startup banner, not the file. A fixed sleep
   * therefore only passes while the runner is fast enough: a cold Windows runner
   * took longer than the old 1000ms to get PowerShell going, so the assertion ran
   * against the banner alone and the job failed. Polling returns as soon as the
   * lines land, and only gives up if they genuinely never arrive.
   */
  const expectTailedLines = () => vi.waitFor(() => {
    expect(client.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('line 1'))
    expect(client.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('line 2'))
    expect(client.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('line 3'))
  }, { timeout: 15000, interval: 50 })

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    authFilePath = resolve(process.env.UIX_STORAGE_PATH, 'auth.json')
    secretsFilePath = resolve(process.env.UIX_STORAGE_PATH, '.uix-secrets')
    logFilePath = resolve(process.env.UIX_STORAGE_PATH, 'homebridge.log')

    // Setup test config
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // Setup test auth file
    await copy(resolve(__dirname, '../mocks', 'auth.json'), authFilePath)
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), secretsFilePath)

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [LogModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())

    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    configService = app.get(ConfigService)
    logService = app.get(LogService)
    logGateway = app.get(LogGateway)
    nodePtyService = app.get(NodePtyService)
  })

  beforeEach(async () => {
    if (client) {
      client.emit('disconnect')
    }

    vi.resetAllMocks()

    // create sample data
    const sampleLogData = ['line 1', 'line 2', 'line 3'].join('\n')
    await writeFile(logFilePath, sampleLogData)

    // create client
    client = authorizeWsClient(new EventEmitter(), { username: 'admin', admin: true })

    vi.spyOn(client, 'emit')
    vi.spyOn(client, 'on')

    // Unset log mode between each test
    configService.ui.sudo = false
    configService.ui.log = undefined
    logService.setLogMethod()
  })

  it('ON /log/tail-log (native)', async () => {
    // Set log mode to native
    configService.ui.log = { method: 'native', path: logFilePath }
    logService.setLogMethod()

    // check the log command is correct
    expect((logService as any).useNative).toBe(true)
    expect((logService as any).command).toBeUndefined()

    logGateway.connect(client, size)

    await expectTailedLines()
  })

  it('ON /log/tail-log (tail)', async () => {
    // This test will not run on windows
    if (platform() === 'win32') {
      return
    }

    // Set log mode to file
    configService.ui.log = { method: 'file', path: logFilePath }
    logService.setLogMethod()

    // check the log command is correct
    expect((logService as any).useNative).toBe(false)
    expect((logService as any).command).toEqual(['tail', '-n', '500', '-f', logFilePath])

    logGateway.connect(client, size)

    await expectTailedLines()
  })

  it('ON /log/tail-log (tail - with sudo)', async () => {
    // This test will not run on windows
    if (platform() === 'win32') {
      return
    }

    // Set log mode to file and enable sudo
    configService.ui.sudo = true
    configService.ui.log = { method: 'file', path: logFilePath }
    logService.setLogMethod()

    // check the log command is correct
    expect((logService as any).useNative).toBe(false)
    expect((logService as any).command).toEqual(['sudo', '-n', 'tail', '-n', '500', '-f', logFilePath])
  })

  it('ON /log/tail-log (systemd)', async () => {
    // This test will not run on windows
    if (platform() === 'win32') {
      return
    }

    // Set log mode to systemd
    configService.ui.log = { method: 'systemd' }
    logService.setLogMethod()

    // check the log command is correct
    expect((logService as any).useNative).toBe(false)
    expect((logService as any).command).toEqual(['journalctl', '-o', 'cat', '-n', '500', '-f', '-u', 'homebridge'])
  })

  it('ON /log/tail-log (systemd - with sudo)', async () => {
    // This test will not run on windows
    if (platform() === 'win32') {
      return
    }

    // Set log mode to systemd
    configService.ui.sudo = true
    configService.ui.log = { method: 'systemd' }
    logService.setLogMethod()

    // check the log command is correct
    expect((logService as any).useNative).toBe(false)
    expect((logService as any).command).toEqual(['sudo', '-n', 'journalctl', '-o', 'cat', '-n', '500', '-f', '-u', 'homebridge'])
  })

  it('ON /log/tail-log (powershell)', async () => {
    // This test will only run on Windows
    if (platform() !== 'win32') {
      return
    }

    // Set log mode to file
    configService.ui.log = { method: 'file', path: logFilePath }
    logService.setLogMethod()

    // check the log command is correct
    expect((logService as any).useNative).toBe(false)
    expect((logService as any).command).toEqual(['powershell.exe', '-NoProfile', '-Command', 'Get-Content -LiteralPath $env:UIX_LOG_PATH -Wait -Tail 200'])
    expect((logService as any).commandEnv).toEqual({ UIX_LOG_PATH: logFilePath })

    logGateway.connect(client, size)

    await expectTailedLines()
  })

  it('ON /log/tail-log (cleans up connections)', async () => {
    // Set log mode to native
    configService.ui.log = { method: 'native', path: logFilePath }
    logService.setLogMethod()

    logGateway.connect(client, size)

    await vi.waitFor(() => {
      // Ensure the log is working
      expect(client.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('line 1'))
      // Initial listeners (the tail attaches after the initial read)
      expect((logService as any).nativeTail?.listenerCount('line')).toBe(1)
    })
    expect(client.listenerCount('disconnect')).toBe(1)
    expect(client.listenerCount('end')).toBe(1)

    // Emit disconnect
    client.emit('disconnect')

    // Ensure listeners have been removed
    await vi.waitFor(() => {
      expect((logService as any).nativeTail.listenerCount('line')).toBe(0)
      expect(client.listenerCount('disconnect')).toBe(0)
      expect(client.listenerCount('end')).toBe(0)
    })
  })

  it('ON /log/tail-log (native - disconnect before the tail attaches)', async () => {
    // Regression: the disconnect handler was attached only after the initial
    // `await stat()`, so a client leaving in that window stayed on the shared
    // Tail forever
    configService.ui.log = { method: 'native', path: logFilePath }
    logService.setLogMethod()

    const linesBefore = (logService as any).nativeTail?.listenerCount('line') ?? 0

    // connect() does not return the tail's promise, so take it from a spy
    const tailing = vi.spyOn(logService as any, 'tailLogFromFileNative')
    logGateway.connect(client, size)
    // still inside the stat() await
    client.emit('disconnect')

    // let the tail set-up run to completion after the client left
    await tailing.mock.results[0].value
    tailing.mockRestore()

    expect((logService as any).nativeTail?.listenerCount('line') ?? 0).toBe(linesBefore)
    expect(client.listenerCount('disconnect')).toBe(0)
    expect(client.listenerCount('end')).toBe(0)
    expect((logService as any).activeClients.has(client)).toBe(false)
  })

  describe('custom log command', () => {
    let originalTerminal: boolean

    beforeAll(() => {
      originalTerminal = configService.enableTerminalAccess
    })

    afterAll(() => {
      configService.enableTerminalAccess = originalTerminal
    })

    it('refuses a command off the allowlist when terminal access is disabled', async () => {
      configService.enableTerminalAccess = false
      configService.ui.log = { method: 'custom', command: 'bash -c id' }
      logService.setLogMethod()

      expect((logService as any).command).toBeNull()
      const ptySpawn = vi.spyOn(nodePtyService, 'spawn')

      logGateway.connect(client, size)

      expect(client.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('Refusing to run the custom log command "bash -c id"'))
      expect(ptySpawn).not.toHaveBeenCalled()
      // The guard is released so a later tail-log on this socket still works
      expect((logService as any).activeClients.has(client)).toBe(false)
    })

    it('allows an allowlisted command when terminal access is disabled', () => {
      configService.enableTerminalAccess = false
      configService.ui.log = { method: 'custom', command: `tail -n 100 -f ${logFilePath}` }
      logService.setLogMethod()

      expect((logService as any).command).toEqual(['tail', '-n', '100', '-f', logFilePath])
    })

    it('allows any command when terminal access is enabled', () => {
      configService.enableTerminalAccess = true
      configService.ui.log = { method: 'custom', command: 'my-viewer --follow' }
      logService.setLogMethod()

      expect((logService as any).command).toEqual(['my-viewer', '--follow'])
    })
  })

  it.each(['file', 'native'])('refuses a %s log path that points at the secrets in the storage directory', async (method) => {
    const secretPath = resolve(configService.storagePath, 'auth.json')
    configService.ui.log = { method, path: secretPath } as any
    logService.setLogMethod()

    expect((logService as any).command).toBeNull()
    expect((logService as any).useNative).toBe(false)
    const ptySpawn = vi.spyOn(nodePtyService, 'spawn')

    logGateway.connect(client, size)

    expect(client.emit).toHaveBeenCalledWith('stdout', expect.stringContaining(`Refusing to show the log file "${secretPath}"`))
    expect(ptySpawn).not.toHaveBeenCalled()
    expect((logService as any).activeClients.has(client)).toBe(false)
  })

  it('ON /log/tail-log (not configured)', async () => {
    logGateway.connect(client, size)

    await vi.waitFor(() => expect(client.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('Cannot show logs.')))
  })

  describe('shared log command', () => {
    // A controllable mock PTY whose output and exit the test drives
    function makeMockPty() {
      const pty = {
        dataCallback: null as ((data: string) => void) | null,
        exitCallback: null as ((event: { exitCode: number }) => void) | null,
        onData: vi.fn((cb: (data: string) => void) => {
          pty.dataCallback = cb
          return { dispose: vi.fn() }
        }),
        onExit: vi.fn((cb: (e: { exitCode: number }) => void) => {
          pty.exitCallback = cb
          return { dispose: vi.fn() }
        }),
        resize: vi.fn(),
        kill: vi.fn(),
        write: vi.fn(),
      }
      return pty
    }

    const viewer = () => {
      const socket = authorizeWsClient(new EventEmitter(), { username: 'admin', admin: true })
      vi.spyOn(socket, 'emit')
      return socket
    }

    beforeEach(() => {
      configService.ui.log = { method: 'file', path: logFilePath }
      logService.setLogMethod()
    })

    it.skipIf(platform() === 'win32')('runs one process for every viewer, and kills it when the last leaves', async () => {
      const pty = makeMockPty()
      const spawnSpy = vi.spyOn(nodePtyService, 'spawn').mockReturnValue(pty as any)

      const a = viewer()
      const b = viewer()
      logGateway.connect(a, size)
      logGateway.connect(b, size)
      expect(spawnSpy).toHaveBeenCalledTimes(1)

      // fanned out to both
      pty.dataCallback!('first line\r\n')
      expect(a.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('first line'))
      expect(b.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('first line'))

      // one viewer leaving keeps it running for the other
      a.emit('disconnect')
      expect(pty.kill).not.toHaveBeenCalled()
      pty.dataCallback!('second line\r\n')
      expect(a.emit).not.toHaveBeenCalledWith('stdout', expect.stringContaining('second line'))
      expect(b.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('second line'))

      // the last one leaving (here with `end`) stops it
      b.emit('end')
      expect(pty.kill).toHaveBeenCalledTimes(1)
      expect(b.listenerCount('disconnect')).toBe(0)
      expect((logService as any).commandStreams.size).toBe(0)

      // and the next viewer starts a fresh one
      const c = viewer()
      spawnSpy.mockReturnValue(makeMockPty() as any)
      logGateway.connect(c, size)
      expect(spawnSpy).toHaveBeenCalledTimes(2)
      c.emit('disconnect')
    })

    it.skipIf(platform() === 'win32')('replays the recent output to a viewer who joins later', async () => {
      const pty = makeMockPty()
      vi.spyOn(nodePtyService, 'spawn').mockReturnValue(pty as any)

      const first = viewer()
      logGateway.connect(first, size)
      pty.dataCallback!('backlog 1\r\nbacklog 2\r\n')

      const late = viewer()
      logGateway.connect(late, size)
      expect(late.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('backlog 1'))
      expect(late.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('backlog 2'))

      // then follows the live output like everyone else, once
      pty.dataCallback!('live\r\n')
      expect(vi.mocked(late.emit).mock.calls.filter(([, out]) => String(out).includes('live'))).toHaveLength(1)

      first.emit('disconnect')
      late.emit('disconnect')
      expect(pty.kill).toHaveBeenCalledTimes(1)
    })

    it.skipIf(platform() === 'win32')('one viewer leaving does not suppress another viewer\'s tail-exit message', async () => {
      const pty = makeMockPty()
      vi.spyOn(nodePtyService, 'spawn').mockReturnValue(pty as any)

      const a = viewer()
      const b = viewer()
      logGateway.connect(a, size)
      logGateway.connect(b, size)

      a.emit('disconnect')
      // the tail process now exits unexpectedly (exit code 1)
      pty.exitCallback!({ exitCode: 1 })

      expect(b.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('exited with code 1'))
      expect(a.emit).not.toHaveBeenCalledWith('stdout', expect.stringContaining('exited with code 1'))

      // the exited process is not killed again (its pid may have been reused)
      b.emit('disconnect')
      expect(pty.kill).not.toHaveBeenCalled()
    })

    it.skipIf(platform() === 'win32')('streams a real tail to two viewers from one process', async () => {
      const spawnSpy = vi.spyOn(nodePtyService, 'spawn')
      const second = viewer()

      logGateway.connect(client, size)
      logGateway.connect(second, size)
      expect(spawnSpy).toHaveBeenCalledTimes(1)

      await expectTailedLines()
      await vi.waitFor(() => {
        expect(second.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('line 3'))
      }, { timeout: 15000, interval: 50 })

      second.emit('disconnect')
    })
  })

  it('trimLogHistory keeps the last lines, cut at a line start', () => {
    const lines = Array.from({ length: LOG_HISTORY_MAX_LINES + 20 }, (_, i) => `line ${i}\n\r`).join('')
    const trimmed = trimLogHistory(lines)
    expect(trimmed.startsWith('line 20\n\r')).toBe(true)
    expect(trimmed.endsWith(`line ${LOG_HISTORY_MAX_LINES + 19}\n\r`)).toBe(true)
    expect(trimmed.split('\n').length - 1).toBe(LOG_HISTORY_MAX_LINES)

    // a short history, or a partial last line, is kept as it is
    expect(trimLogHistory('a\nb\npartial')).toBe('a\nb\npartial')

    // very long lines are capped by size too
    const long = `${'x'.repeat(LOG_HISTORY_MAX_CHARS)}\nshort\n`
    expect(trimLogHistory(long)).toBe('short\n')
  })

  describe('native method', () => {
    beforeEach(() => {
      configService.ui.log = { method: 'native', path: logFilePath }
      logService.setLogMethod()
    })

    it('follows lines appended after the initial read, sharing one tail between viewers', async () => {
      const second = authorizeWsClient(new EventEmitter(), { username: 'admin', admin: true })
      vi.spyOn(second, 'emit')

      logGateway.connect(client, size)
      logGateway.connect(second, size)
      await expectTailedLines()
      await vi.waitFor(() => expect((logService as any).nativeTail?.listenerCount('line')).toBe(2))

      await appendFile(logFilePath, '\nappended line\n')
      // fs.watch normally reports it at once; the poll catches it within a second otherwise
      for (const viewer of [client, second]) {
        await vi.waitFor(() => {
          expect(viewer.emit).toHaveBeenCalledWith('stdout', expect.stringContaining('appended line'))
        }, { timeout: 5000, interval: 50 })
      }
      expect(vi.mocked(client.emit).mock.calls.filter(([, out]) => String(out).includes('appended line'))).toHaveLength(1)

      second.emit('disconnect')
      expect((logService as any).nativeTail.isWatching).toBe(true)
      client.emit('disconnect')
      expect((logService as any).nativeTail.isWatching).toBe(false)
    })
  })

  describe('emitMessage', () => {
    // Mirrors the line format written by the hb-service supervisor:
    // <grey>[date]<reset> <cyan>[HB Supervisor]<reset> [LEVEL] message
    const supervisor = '\x1B[37m[1/1/2026, 12:00:00 PM]\x1B[0m \x1B[36m[HB Supervisor]\x1B[0m'

    const originalDebugLogging = process.env.UIX_DEBUG_LOGGING

    beforeEach(() => {
      delete process.env.UIX_DEBUG_LOGGING
    })

    afterAll(() => {
      if (originalDebugLogging === undefined) {
        delete process.env.UIX_DEBUG_LOGGING
      } else {
        process.env.UIX_DEBUG_LOGGING = originalDebugLogging
      }
    })

    function emitted(msg: string): string[] {
      const target = authorizeWsClient(new EventEmitter(), { username: 'admin', admin: true })
      const chunks: string[] = []
      target.on('stdout', (data: string) => chunks.push(data))
      ;(logService as any).emitMessage(target, msg)
      return chunks
    }

    it('strips the level tag from supervisor lines', () => {
      const [out] = emitted(`${supervisor} [INFO] Started Homebridge.\n\r`)

      expect(out).toContain('[HB Supervisor]')
      expect(out).not.toContain('[INFO]')
      expect(out).toContain('Started Homebridge.')
    })

    it('colorizes supervisor SUCCESS/WARN/ERROR content', () => {
      expect(emitted(`${supervisor} [SUCCESS] done\n\r`)[0]).toContain(green('done'))
      expect(emitted(`${supervisor} [WARN] careful\n\r`)[0]).toContain(yellow('careful'))
      expect(emitted(`${supervisor} [ERROR] broken\n\r`)[0]).toContain(red('broken'))
    })

    it('suppresses supervisor DEBUG lines when debug logging is off', () => {
      const chunks = emitted(`${supervisor} [DEBUG] internal detail\n\r`)

      expect(chunks).toHaveLength(0)
    })

    it('keeps supervisor DEBUG lines when UIX_DEBUG_LOGGING is enabled', () => {
      process.env.UIX_DEBUG_LOGGING = '1'

      const [out] = emitted(`${supervisor} [DEBUG] internal detail\n\r`)

      expect(out).toContain('internal detail')
      expect(out).not.toContain('[DEBUG]')
    })

    it('removes only the supervisor DEBUG line from a multi-line chunk', () => {
      const [out] = emitted([
        `${supervisor} [INFO] line one`,
        `${supervisor} [DEBUG] line two`,
        '[1/1/2026, 12:00:00 PM] [homebridge-foo] line three',
        '',
      ].join('\n\r'))

      expect(out).toContain('line one')
      expect(out).not.toContain('line two')
      expect(out).toContain('[homebridge-foo] line three')
    })

    it('does not drop plugin output that happens to contain [DEBUG]', () => {
      const [out] = emitted('[1/1/2026, 12:00:00 PM] [homebridge-foo] payload contained [DEBUG] marker\n\r')

      expect(out).toContain('payload contained [DEBUG] marker')
    })

    it('does not strip or recolour tags in plugin output', () => {
      const line = '[1/1/2026, 12:00:00 PM] [homebridge-foo] upstream said [ERROR] oops\n\r'

      expect(emitted(line)[0]).toBe(line)
    })

    it('suppresses a supervisor DEBUG line split across two chunks', () => {
      const target = authorizeWsClient(new EventEmitter(), { username: 'admin', admin: true })
      const chunks: string[] = []
      target.on('stdout', (data: string) => chunks.push(data))
      const service = logService as any

      service.emitMessage(target, `${supervisor} [DEB`)
      service.emitMessage(target, 'UG] secret detail\n\r')

      expect(chunks).toHaveLength(0)

      service.emitMessage(target, `${supervisor} [INFO] visible\n\r`)

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toContain('visible')
      expect(chunks[0]).not.toContain('secret detail')
    })

    it('strips the tag from a supervisor line split across two chunks', () => {
      const target = authorizeWsClient(new EventEmitter(), { username: 'admin', admin: true })
      const chunks: string[] = []
      target.on('stdout', (data: string) => chunks.push(data))
      const service = logService as any

      service.emitMessage(target, `${supervisor} [SUC`)
      service.emitMessage(target, 'CESS] made it\n\r')

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toContain(green('made it'))
      expect(chunks[0]).not.toContain('[SUCCESS]')
    })

    it('emits complete lines immediately while holding the partial remainder', () => {
      const target = authorizeWsClient(new EventEmitter(), { username: 'admin', admin: true })
      const chunks: string[] = []
      target.on('stdout', (data: string) => chunks.push(data))
      const service = logService as any

      service.emitMessage(target, 'line a\n\rline b partial')

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe('line a\n\r')

      service.emitMessage(target, ' now complete\n\r')

      expect(chunks).toHaveLength(2)
      expect(chunks[1]).toBe('line b partial now complete\n\r')
    })

    it('flushes a held partial line after a short idle timeout', async () => {
      const target = authorizeWsClient(new EventEmitter(), { username: 'admin', admin: true })
      const chunks: string[] = []
      target.on('stdout', (data: string) => chunks.push(data))
      const service = logService as any

      vi.useFakeTimers()
      try {
        service.emitMessage(target, `${supervisor} [INFO] no trailing newline`)

        expect(chunks).toHaveLength(0)

        // PARTIAL_LINE_FLUSH_MS (50ms) of idle time
        vi.advanceTimersByTime(49)
        expect(chunks).toHaveLength(0)
        vi.advanceTimersByTime(1)
      } finally {
        vi.useRealTimers()
      }

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toContain('no trailing newline')
      expect(chunks[0]).not.toContain('[INFO]')
    })
  })

  describe('re-checking the user before streaming', () => {
    function streamTo(target: any, msg: string) {
      const chunks: string[] = []
      target.on('stdout', (data: string) => chunks.push(data))
      ;(logService as any).emitMessage(target, `${msg}\n`)
      return chunks
    }

    it('stops streaming to a user revoked since the last check', async () => {
      const target = authorizeWsClient(new EventEmitter(), { username: 'admin', admin: true })
      target.data.verifiedAt = 0
      target.data.revalidateUser.mockRejectedValue(new Error('User no longer valid'))

      const chunks = streamTo(target, 'secret line')
      await vi.waitFor(() => expect(target.disconnect).toHaveBeenCalledWith(true))

      expect(chunks).toEqual([])
    })

    it('stops streaming to a non-admin once restrictLogsToAdmins is on', async () => {
      const target = authorizeWsClient(new EventEmitter(), { username: 'bob', admin: false })
      configService.restrictLogsToAdmins = true
      try {
        const chunks = streamTo(target, 'secret line')
        await vi.waitFor(() => expect(target.disconnect).toHaveBeenCalledWith(true))

        expect(chunks).toEqual([])
      } finally {
        configService.restrictLogsToAdmins = false
      }
    })

    it('keeps streaming to a non-admin while the log is unrestricted', () => {
      const target = authorizeWsClient(new EventEmitter(), { username: 'bob', admin: false })

      expect(streamTo(target, 'a line').join('')).toContain('a line')
      expect(target.disconnect).not.toHaveBeenCalled()
    })
  })

  afterAll(async () => {
    await app.close()
  })
})
