import type { LlmAdapter } from '@deepseek-ai/dsh-llm'

/** Outcome of one host call; the registrar applies host semantics only, never owner policy. */
export type PublishResult = { ok: true } | { ok: false; phase: 'initial' | 'replace'; code: string; route?: string }
export interface RouteRegistrar {
  /** Make `next` the full route set: first call registers, later calls `replace`. */
  publish(next: string[]): PublishResult
  /** Routes the host currently holds for this plugin (as far as the plugin can know). */
  current(): string[]
  /** Set once the initial registration threw; the plugin must then never call the host again. */
  fatal(): undefined | { code: string; route?: string }
  /** Release the registration handle. May throw (host `INVARIANT`); callers isolate it. */
  dispose(): void
}
type Registration = (() => void) & { replace(next: string[]): void }
type Registry = { registerAdapter(providers: string[], adapter: LlmAdapter): unknown }

const codeOf = (error: unknown): string => String((error as { code?: unknown } | null)?.code ?? 'UNKNOWN')
const routeIn = (error: unknown): string | undefined => /provider "([^"]+)"/.exec(String((error as { message?: unknown } | null)?.message ?? ''))?.[1]

/**
 * D6 host-call semantics:
 * - initial `registerAdapter`: any throw is a fatal start-up state (the host may have committed routes without
 *   returning a handle, so nothing can be retried or undone) and the host is never called again;
 * - `replace`: DUPLICATE_ADAPTER / INVALID_ADAPTER left the registry unchanged and are reported; INVARIANT means
 *   the host already committed the new set, so it counts as success;
 * - after dispose every call is a no-op.
 */
export function createRouteRegistrar(llm: Registry, adapter: LlmAdapter): RouteRegistrar {
  let handle: Registration | undefined, held: string[] = [], fatal: { code: string; route?: string } | undefined, disposed = false
  return {
    publish(next) {
      if (disposed) return { ok: true }
      if (fatal) return { ok: false, phase: 'initial', ...fatal }
      if (!handle) {
        if (!next.length) return { ok: true }
        try {
          handle = llm.registerAdapter(next, adapter) as Registration
          held = [...next]
          return { ok: true }
        } catch (error) {
          const route = routeIn(error)
          fatal = { code: codeOf(error), ...(route ? { route } : {}) }
          return { ok: false, phase: 'initial', ...fatal }
        }
      }
      try { handle.replace(next); held = [...next]; return { ok: true } }
      catch (error) {
        const code = codeOf(error)
        if (code === 'INVARIANT') { held = [...next]; return { ok: true } }
        const route = routeIn(error)
        return { ok: false, phase: 'replace', code, ...(route ? { route } : {}) }
      }
    },
    current: () => [...held],
    fatal: () => fatal,
    dispose() {
      disposed = true
      const release = handle
      handle = undefined
      release?.()
    },
  }
}
