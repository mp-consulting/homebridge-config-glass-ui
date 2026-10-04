import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

/**
 * Dev-only supervisor that sits between nodemon and hb-service.
 *
 * When the UI updates itself it restarts by calling `process.exit(0)` and
 * leaving it to whatever supervises it - systemd, launchd, pm2, the Docker
 * entrypoint - to start it again. In `npm run watch` the supervisor is
 * nodemon, and nodemon is not one: a clean exit makes it print "clean exit -
 * waiting for changes before restart" and sit there. The browser is then left
 * on the restarting page for ever, and the watch session has to be killed by
 * hand.
 *
 * That matters because hb-service imports the UI in-process (`runUi`), so the
 * UI's exit takes the whole watch server with it, Homebridge child included.
 *
 * This does the one thing nodemon will not: start it again. A restart nodemon
 * asked for is passed straight through and NOT respawned - nodemon starts the
 * next one itself, and a respawn here would race it for the port.
 *
 * It also copies the output into `<storage>/homebridge.log`. Watch runs
 * hb-service with --stdout, which keeps the log on the terminal and never
 * writes that file, so the Logs page and Log Doctor (which read it) had
 * nothing to show in development. The file starts empty on each start.
 */

const RESPAWN_DELAY_MS = 500

const command = process.argv[2]
const commandArgs = process.argv.slice(3)

// hb-service's own default: -U <path> if given, else ~/.homebridge
const storageFlag = commandArgs.findIndex(arg => arg === '-U' || arg === '--user-storage-path')
const storagePath = storageFlag === -1 ? resolve(homedir(), '.homebridge') : resolve(commandArgs[storageFlag + 1])
const logPath = resolve(storagePath, 'homebridge.log')

let child = null
let shuttingDown = false

function start() {
  const logFile = createWriteStream(logPath, { flags: 'w' })
  logFile.on('error', error => console.error(`[watch] cannot write ${logPath}: ${error.message}`))

  // Piped output is not a TTY, so keep the colours the terminal would have had.
  const env = process.stdout.isTTY ? { FORCE_COLOR: '1', ...process.env } : process.env
  child = spawn(command, commandArgs, { stdio: ['inherit', 'pipe', 'pipe'], env })
  for (const [from, to] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    from.on('data', (chunk) => {
      to.write(chunk)
      logFile.write(chunk)
    })
  }

  child.on('error', (error) => {
    console.error(`[watch] could not start "${command}": ${error.message}`)
    process.exit(1)
  })

  // 'close' comes after the output has been drained; 'exit' can come before it
  child.on('close', () => logFile.end())

  child.on('exit', (code, signal) => {
    child = null

    // nodemon (or the user) is taking us down - it will start the next one.
    if (shuttingDown) {
      process.exit(0)
    }

    // Killed by something other than its own choice: not ours to second-guess.
    if (signal) {
      console.log(`[watch] the server was killed by ${signal} - not restarting it`)
      process.exit(1)
    }

    // A crash is worth seeing. Leave it stopped so the error stays on screen,
    // the same as nodemon would.
    if (code !== 0) {
      console.error(`[watch] the server exited with code ${code} - not restarting it`)
      process.exit(code)
    }

    // A clean exit here is the UI restarting itself after updating.
    console.log('[watch] the server exited cleanly (it updated itself) - starting it again')
    setTimeout(() => {
      // The signal may have landed while we were waiting.
      if (!shuttingDown) {
        start()
      }
    }, RESPAWN_DELAY_MS)
  })
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    shuttingDown = true
    if (child) {
      child.kill(signal)
    } else {
      process.exit(0)
    }
  })
}

start()
