import { CollaborationUnavailableError, readForCollaborationCaller, type CollaborationCallerPorts } from './caller.js'
import { parseCollaborationContext, type CollaborationContextRecord } from './context.js'

export interface CollaborationQueryDependencies {
  readonly ports: CollaborationCallerPorts
  readonly store: { get(parentSessionId: string): CollaborationContextRecord | undefined }
}

/** Tool execution identity only; never accept a model-supplied parent selector. */
export async function queryCollaborationContext(execution: unknown, deps: CollaborationQueryDependencies): Promise<CollaborationContextRecord> {
  try {
    const sessionId = (execution as { agent?: { id?: unknown } } | undefined)?.agent?.id
    if (typeof sessionId !== 'string') throw new CollaborationUnavailableError()
    return await readForCollaborationCaller(sessionId, deps.ports, caller => {
      // Read at the resolver's final fence: awaiting a separate resolve() then
      // reading here would permit intervening revocation microtasks.
      const raw = deps.store.get(caller.parentSessionId)
      if (raw === undefined) throw new CollaborationUnavailableError()
      const current = parseCollaborationContext(raw)
      if (current.parentSessionId !== caller.parentSessionId) throw new CollaborationUnavailableError()
      return current
    })
  } catch {
    throw new CollaborationUnavailableError()
  }
}
