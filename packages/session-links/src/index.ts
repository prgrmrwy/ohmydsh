/**
 * Host entry for dsh-session-links.
 *
 * Registers one read-only Connection RPC channel, `/dsh-session-links`,
 * whose single `links` endpoint reads a session's **complete** durable
 * event log through the official sessionPersistence service and returns its
 * deduped link set (the "whole session" baseline the browser window cannot
 * see). The web half keeps its live snapshot for new-message increments.
 *
 * Wiring mirrors dsh-system-clock: `connection` is deliberately NOT in the
 * plugin's inject list (headless compositions lack it), the channel is
 * registered lazily once the service exists, and every business outcome
 * returns an RpcResult (handlers never throw). Read-only: no files written,
 * no commands, no credentials, no model faces. `authority: 'loopback'` keeps
 * the channel confined to the trusted host fence.
 *
 * @module dsh-session-links
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: brings the host Context.connection merge (HostConnectionHandle).
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only: brings the host Context.sessionPersistence merge.
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SESSION_LINKS_CHANNEL, SESSION_LINKS_ENTRIES_ENDPOINT, type SessionLinksRequest } from './contract.js'
import { extractSession } from './host/extract.js'

export const name = 'session-links'

/** Headless-safe: the connection service is resolved lazily below. */
export const inject: string[] = []

/** Short TTL cache: the log fold is cheap but repeated panel opens should not reparse. */
const BASELINE_CACHE_TTL_MS = 30_000

type BaselineCacheEntry = { value: unknown; at: number }

/** Mount the `/dsh-session-links` RPC channel when a host connection exists. */
export function apply(ctx: Context): void {
  const cache = new Map<string, BaselineCacheEntry>()

  ctx.inject(['connection'], (child) => {
    const connection = child.get('connection')
    if (connection === undefined) return

    child.effect(() => connection.rpc.handle(
      SESSION_LINKS_CHANNEL,
      async (endpoint, payload) => {
        if (endpoint !== SESSION_LINKS_ENTRIES_ENDPOINT) {
          return {
            ok: false as const,
            error: {
              code: 'internal' as const,
              message: `dsh-session-links: unknown endpoint "${endpoint}"`,
              details: {},
            },
          }
        }
        const request = payload as Partial<SessionLinksRequest> | undefined
        const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : undefined
        if (!sessionId) {
          return {
            ok: false as const,
            error: {
              code: 'internal' as const,
              message: 'dsh-session-links: sessionId is required',
              details: {},
            },
          }
        }
        const cached = cache.get(sessionId)
        if (cached !== undefined && Date.now() - cached.at < BASELINE_CACHE_TTL_MS) {
          return { ok: true as const, value: cached.value }
        }
        try {
          const persistence = child.get('sessionPersistence')
          if (persistence === undefined) {
            return {
              ok: false as const,
              error: {
                code: 'internal' as const,
                message: 'dsh-session-links: sessionPersistence service unavailable',
                details: {},
              },
            }
          }
          const { events } = await persistence.readFrom(sessionId as never, 0)
          const tools = child.get('tools')
          const { entries, produced, maxSeq } = extractSession(events, (name, rawArgs) => {
            // Same render-intent seam as api-proxy; a missing tool or a parse
            // throw soft-falls to no view (the client's generic-card default).
            const args = rawArgs === '' ? {} : JSON.parse(rawArgs)
            const view = tools?.get(name)?.presentCall?.(args)
            return view as ReturnType<import('./shared/produced.js').PresentCall>
          })
          const value = { entries, produced, maxSeq, complete: true as const }
          cache.set(sessionId, { value, at: Date.now() })
          return { ok: true as const, value }
        } catch (error) {
          return {
            ok: false as const,
            error: {
              code: 'internal' as const,
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
          }
        }
      },
      { authority: 'loopback' },
    ), 'dsh-session-links: /dsh-session-links rpc channel')
  })
}