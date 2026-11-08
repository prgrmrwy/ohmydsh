/**
 * Cold Session inspection over the official `sessionQuery` read surface.
 *
 * DSH 0.2.1 exposed `sessionController.inspect(sessionId, signal?)`. DSH 0.2.2
 * removed it from `SessionController`. In 0.2.1 that method was a thin wrapper
 * over `sessionQuery.observeSession(id, { signal, projectionMode: 'none' })`
 * that
 *   - treated a header without `cwd` as "not found",
 *   - returned `{ meta: header, inheritedEventCount, events: [...events] }`, and
 *   - released the observation lease before returning.
 *
 * This reproduces exactly that contract on `sessionQuery`, which exists on both
 * runtimes, so Pet's reads keep the same meaning and stay fail closed: a missing,
 * header-less or unreadable Session throws, and callers (which already treat
 * every throw as "unavailable") never fall back to another identity.
 */
import type { SessionHeader } from '@deepseek-ai/dsh-session'

/** The slice of an observation lease this adapter reads. */
interface ObservationLike {
  readonly header: SessionHeader
  readonly inheritedEventCount?: unknown
  readonly events: readonly unknown[]
  [Symbol.dispose]?: () => void
}

/** The slice of `ctx.sessionQuery` this adapter calls. */
export interface SessionQueryObserver {
  observeSession(
    sessionId: never,
    options?: { readonly signal?: AbortSignal; readonly projectionMode?: 'all' | 'none' },
  ): Promise<ObservationLike>
}

/** What 0.2.1 `sessionController.inspect` resolved with. */
export interface SessionInspectionResult {
  readonly meta: SessionHeader
  readonly inheritedEventCount?: unknown
  readonly events: readonly unknown[]
}

/**
 * Build the `inspect` function over a `sessionQuery` service.
 * @param query - the Host `sessionQuery` service, or undefined when absent.
 * @returns `inspect`, or undefined when the service cannot observe Sessions
 *   (callers then keep the capability unavailable instead of guessing).
 */
export function createSessionInspector(
  query: Partial<SessionQueryObserver> | undefined,
): ((sessionId: string, signal?: AbortSignal) => Promise<SessionInspectionResult>) | undefined {
  if (typeof query?.observeSession !== 'function') return undefined
  // Keep the receiver: `observeSession` is a service method that uses `this`.
  const observe = query.observeSession.bind(query)
  return async (sessionId, signal) => {
    const observation = await observe(sessionId as never, {
      ...(signal === undefined ? {} : { signal }),
      projectionMode: 'none',
    })
    try {
      if (observation.header?.cwd === undefined) throw new Error(`session "${sessionId}" not found`)
      return {
        meta: observation.header,
        inheritedEventCount: observation.inheritedEventCount,
        events: [...observation.events],
      }
    } finally {
      observation[Symbol.dispose]?.()
    }
  }
}
