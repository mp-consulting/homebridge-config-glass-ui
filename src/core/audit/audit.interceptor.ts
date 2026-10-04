import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'

import { applyDecorators, Inject, Injectable, SetMetadata, UseInterceptors } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { catchError, tap, throwError } from 'rxjs'

import { auditActor, AuditService } from './audit.service.js'

export const AUDIT_METADATA = 'glass-ui:audit'

/** What a details function gets to pick from. */
export interface AuditContext {
  /** HTTP route params (empty over a socket). */
  params: Record<string, string>
  query: Record<string, unknown>
  /** The HTTP body, or the socket message payload. */
  body: unknown
  /** What the handler returned (undefined when it failed). */
  result?: unknown
}

export interface AuditOptions {
  /** What the action is about: a plugin name, a token id… */
  target?: (ctx: AuditContext) => unknown
  /** Extra facts to keep (redacted and size-capped by AuditService). */
  details?: (ctx: AuditContext) => Record<string, unknown> | undefined
}

interface AuditMetadata extends AuditOptions {
  action: string
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function errorStatus(error: unknown): number | undefined {
  const e = error as { getStatus?: () => number, status?: number }
  return typeof e?.getStatus === 'function' ? e.getStatus() : (typeof e?.status === 'number' ? e.status : undefined)
}

/** The listed fields of a body, when they are set. */
export function pick(body: unknown, keys: string[]): Record<string, unknown> {
  const source = asRecord(body)
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]))
}

/** A plugin action's package name (`{ name }` in the body or socket payload). */
export const auditPluginTarget = ({ body }: AuditContext) => asRecord(body).name
/** A plugin action's requested version. */
export const auditPluginDetails = ({ body }: AuditContext) => pick(body, ['version'])

/**
 * Records the decorated handler (HTTP route or socket message) in the audit
 * log once it settles: who, the action, its target, whether it worked.
 * @example `@Audited('plugin.install', { target: ({ body }) => body.name })`
 */
export function Audited(action: string, options: AuditOptions = {}) {
  return applyDecorators(
    SetMetadata(AUDIT_METADATA, { action, ...options } satisfies AuditMetadata),
    UseInterceptors(AuditInterceptor),
  )
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMetadata | undefined>(AUDIT_METADATA, context.getHandler())
    if (!meta) {
      return next.handle()
    }
    const base = this.describe(context)
    const write = (ok: boolean, result?: unknown, error?: unknown) => {
      const ctx: AuditContext = { ...base.ctx, result }
      let target: unknown
      let details: Record<string, unknown> | undefined
      try {
        target = meta.target?.(ctx) ?? ctx.params.pluginName ?? ctx.params.id ?? ctx.params.deviceId ?? ctx.params.backupId
        details = meta.details ? meta.details(ctx) : undefined
      } catch {
        // A details picker must never fail the request
      }
      const status = error === undefined ? undefined : errorStatus(error)
      void this.audit.record({
        action: meta.action,
        actor: auditActor(base.user),
        ok,
        target: target === undefined || target === null ? undefined : String(target),
        details: { ...base.route, ...(status ? { status } : {}), ...details },
        error: error === undefined ? undefined : ((error as Error)?.message ?? String(error)),
        ip: base.ip,
      })
    }
    return next.handle().pipe(
      // Socket handlers report a failure by returning the WsException
      tap(result => (result instanceof Error ? write(false, undefined, result) : write(true, result))),
      catchError((error) => {
        write(false, undefined, error)
        return throwError(() => error)
      }),
    )
  }

  private describe(context: ExecutionContext) {
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient<{ data?: { user?: Record<string, unknown> }, handshake?: { address?: string } }>()
      return {
        user: client?.data?.user,
        ip: client?.handshake?.address,
        route: { via: 'socket' },
        ctx: { params: {}, query: {}, body: context.switchToWs().getData() } as AuditContext,
      }
    }
    const req = context.switchToHttp().getRequest<{
      user?: Record<string, unknown>
      ip?: string
      method?: string
      params?: Record<string, string>
      query?: Record<string, unknown>
      body?: unknown
      routeOptions?: { url?: string }
    }>()
    return {
      user: req?.user,
      ip: req?.ip,
      route: { method: req?.method, route: req?.routeOptions?.url },
      ctx: { params: req?.params ?? {}, query: asRecord(req?.query), body: req?.body } as AuditContext,
    }
  }
}

/**
 * Global: every write request (anything but GET/HEAD/OPTIONS) made with an
 * API token is audited as `api-token.request`, unless its handler is
 * `@Audited` already (that entry names the token).
 */
@Injectable()
export class ApiTokenWriteAuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || this.reflector.get(AUDIT_METADATA, context.getHandler())) {
      return next.handle()
    }
    const req = context.switchToHttp().getRequest<{ user?: Record<string, unknown>, method?: string, url?: string, ip?: string, routeOptions?: { url?: string } }>()
    if (typeof req?.user?.apiTokenId !== 'string' || READ_METHODS.has(String(req.method).toUpperCase())) {
      return next.handle()
    }
    const write = (ok: boolean, error?: unknown) => {
      const status = error === undefined ? undefined : errorStatus(error)
      void this.audit.record({
        action: 'api-token.request',
        actor: auditActor(req.user),
        ok,
        target: `${req.method} ${String(req.url ?? '').split('?')[0]}`,
        details: { route: req.routeOptions?.url, ...(status ? { status } : {}) },
        error: error === undefined ? undefined : ((error as Error)?.message ?? String(error)),
        ip: req.ip,
      })
    }
    return next.handle().pipe(
      tap(() => write(true)),
      catchError((error) => {
        write(false, error)
        return throwError(() => error)
      }),
    )
  }
}
