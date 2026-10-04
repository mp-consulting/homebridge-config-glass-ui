import type { PluginActionDto } from './plugins.dto.js'
import type { PluginAction, PluginJob } from './plugins.interfaces.js'

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { Inject, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common'

import { Logger } from '../../core/logger/logger.service.js'
import { PluginsService } from './plugins.service.js'

/** How much of npm's output a job keeps (the most recent part) */
export const PLUGIN_JOB_OUTPUT_LIMIT = 64 * 1024

/** How long a finished job can still be looked up */
export const PLUGIN_JOB_TTL_MS = 60 * 60 * 1000

/** The most jobs kept at once; the oldest finished ones go first */
const MAX_JOBS = 100

// CSI / OSC escape sequences npm and the installer colour their output with
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1B(?:\[[\d;?]*[a-z]|\][^\x07]*\x07)/gi

/** Plain text from terminal output: no colour codes, `\n` line endings */
export function toPlainOutput(data: unknown): string {
  return String(data ?? '')
    .replace(ANSI_PATTERN, '')
    .replace(/\r\n|\n\r/g, '\n')
    .replace(/\r/g, '\n')
}

/**
 * Plugin installs, updates and uninstalls started over REST
 * (`POST /plugins/install|update|uninstall`). Each runs the same
 * PluginsService.runPluginAction the `plugins` socket namespace uses, with npm's
 * output captured into a bounded buffer instead of a terminal. Jobs live in
 * memory only and are dropped PLUGIN_JOB_TTL_MS after they finish.
 */
@Injectable()
export class PluginJobsService implements OnModuleDestroy {
  private readonly jobs = new Map<string, PluginJob>()

  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Start a job and return it straight away. An invalid name or version is
   * rejected here (400) rather than as a failed job.
   */
  start(action: PluginAction, request: { name: string, version?: string }): PluginJob {
    this.pluginsService.assertValidPackageRequest(request.name, request.version)

    const job: PluginJob = {
      id: randomUUID(),
      action,
      name: request.name,
      ...(request.version ? { version: request.version } : {}),
      status: 'running',
      output: '',
      startedAt: new Date().toISOString(),
    }
    this.prune()
    this.jobs.set(job.id, job)

    const client = new EventEmitter()
    client.on('stdout', (data: unknown) => this.append(job, toPlainOutput(data)))

    // A fresh object: the installer fills in the version it resolved
    const pluginAction: PluginActionDto = { name: request.name, version: request.version }

    this.logger.log(`Started plugin job ${job.id}: ${action} ${request.name}${request.version ? `@${request.version}` : ''}.`)
    void this.pluginsService.runPluginAction(action, pluginAction, client)
      .then(() => {
        this.finish(job, 'succeeded')
      })
      .catch((e) => {
        const message = e?.message ?? String(e)
        this.append(job, `\n${toPlainOutput(message)}\n`)
        this.finish(job, 'failed', message)
        this.logger.error(`Plugin job ${job.id} (${action} ${request.name}) failed: ${message}`)
      })

    return this.snapshot(job)
  }

  /** A job by id, or 404 once it is unknown or has expired */
  get(id: string): PluginJob {
    const job = this.jobs.get(id)
    if (!job) {
      throw new NotFoundException('Plugin job not found.')
    }
    return this.snapshot(job)
  }

  onModuleDestroy() {
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer)
    }
    this.expiryTimers.clear()
  }

  private append(job: PluginJob, text: string) {
    if (!text) {
      return
    }
    const output = job.output + text
    job.output = output.length > PLUGIN_JOB_OUTPUT_LIMIT ? output.slice(-PLUGIN_JOB_OUTPUT_LIMIT) : output
  }

  private finish(job: PluginJob, status: 'succeeded' | 'failed', error?: string) {
    job.status = status
    job.finishedAt = new Date().toISOString()
    if (error) {
      job.error = error
    }
    const timer = setTimeout(() => {
      this.jobs.delete(job.id)
      this.expiryTimers.delete(job.id)
    }, PLUGIN_JOB_TTL_MS)
    timer.unref?.()
    this.expiryTimers.set(job.id, timer)
  }

  /** Make room for a new job by dropping the oldest finished ones */
  private prune() {
    if (this.jobs.size < MAX_JOBS) {
      return
    }
    for (const [id, job] of this.jobs) {
      if (this.jobs.size < MAX_JOBS) {
        break
      }
      if (job.status !== 'running') {
        this.jobs.delete(id)
        clearTimeout(this.expiryTimers.get(id))
        this.expiryTimers.delete(id)
      }
    }
  }

  private snapshot(job: PluginJob): PluginJob {
    return { ...job }
  }
}
