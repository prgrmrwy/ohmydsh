/** Cold identity adapter; no Agent loading, history projection, or policy writes. */
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CollaborationCallerPorts, CollaborationSessionIdentity } from './caller.js'

export interface CollaborationHostIdentityDeps {
  readonly sessionController?: {
    /** Actual SessionController.inspect shape is checked at the boundary. */
    inspect(sessionId: SessionId): Promise<unknown>
  }
  readonly workspaceRegistry?: { readonly archivedSessionIds: readonly SessionId[] | readonly string[] }
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.trim() === id
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Missing archive facts count as unavailable for authorization, never as "none
 * archived". The returned method is a conservative guard, not UI archive status.
 */
export function createCollaborationHostIdentity(
  deps: CollaborationHostIdentityDeps,
): Pick<CollaborationCallerPorts, 'inspect' | 'isArchived'> {
  const isArchived = (id: string): boolean => {
    try {
      if (!validId(id)) return true
      const ids = deps.workspaceRegistry?.archivedSessionIds
      if (!Array.isArray(ids) || !ids.every(validId)) return true
      return ids.includes(id)
    } catch { return true }
  }
  return {
    isArchived,
    async inspect(id): Promise<CollaborationSessionIdentity | undefined> {
      try {
        if (!validId(id) || isArchived(id) || deps.sessionController === undefined) return undefined
        const inspection = await deps.sessionController.inspect(SessionId(id))
        if (!record(inspection) || !record(inspection.meta) || isArchived(id)) return undefined
        const { meta } = inspection
        if (meta.id !== id) return undefined
        const parent = meta.parentSession
        // Do not read inspection.events; identity lives in metadata. Consumers
        // wanting titles/recovery facts must use a distinct authorized projection.
        if (parent === undefined) return Object.freeze({ id })
        if (!validId(parent) || parent === id) return undefined
        return Object.freeze({ id, parentSessionId: parent })
      } catch { return undefined }
    },
  }
}
