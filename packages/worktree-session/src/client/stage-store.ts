import type { OperationPhase, RefEntry } from '../wire.ts'

export interface ClientStage {
  sessionId: string
  cwd: string
  enabled: boolean
  baseRef?: string
  refs: readonly RefEntry[]
  operationId?: string
  targetSessionId?: string
  phase: 'idle' | 'validating' | 'host' | 'workspace' | 'transfer' | 'submit' | OperationPhase | 'error' | 'uncertain' | 'done'
  error?: string
  submitted: boolean
}

const stages = new Map<string, ClientStage>()
const listeners = new Map<string, Set<() => void>>()

function persistenceKey(sessionId: string): string { return `dsh.worktree-session.v1.${sessionId}` }

function restore(sessionId: string, cwd: string): Partial<ClientStage> {
  try {
    const raw = localStorage.getItem(persistenceKey(sessionId))
    if (raw === null) return {}
    const value = JSON.parse(raw) as Partial<ClientStage>
    if (value.cwd !== cwd) return {}
    return {
      enabled: value.enabled === true,
      ...(typeof value.baseRef === 'string' ? { baseRef: value.baseRef } : {}),
      ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}),
      ...(typeof value.targetSessionId === 'string' ? { targetSessionId: value.targetSessionId } : {}),
      submitted: value.submitted === true,
    }
  } catch { return {} }
}

function persist(stage: ClientStage): void {
  try {
    localStorage.setItem(persistenceKey(stage.sessionId), JSON.stringify({ cwd: stage.cwd, enabled: stage.enabled, baseRef: stage.baseRef, operationId: stage.operationId, targetSessionId: stage.targetSessionId, submitted: stage.submitted }))
  } catch { /* browser storage may be disabled */ }
}

export function getStage(sessionId: string, cwd: string): ClientStage {
  const existing = stages.get(sessionId)
  if (existing !== undefined && existing.cwd === cwd) return existing
  const stage: ClientStage = { sessionId, cwd, enabled: false, refs: [], phase: 'idle', submitted: false, ...restore(sessionId, cwd) }
  stages.set(sessionId, stage)
  return stage
}

export function setStage(sessionId: string, cwd: string, patch: Partial<ClientStage>): ClientStage {
  const stage = { ...getStage(sessionId, cwd), ...patch, sessionId, cwd }
  stages.set(sessionId, stage)
  persist(stage)
  for (const listener of listeners.get(sessionId) ?? []) listener()
  return stage
}

export function resetStage(sessionId: string): void {
  stages.delete(sessionId)
  try { localStorage.removeItem(persistenceKey(sessionId)) } catch { /* no-op */ }
  for (const listener of listeners.get(sessionId) ?? []) listener()
}

export function subscribeStage(sessionId: string, listener: () => void): () => void {
  const set = listeners.get(sessionId) ?? new Set()
  set.add(listener)
  listeners.set(sessionId, set)
  return () => { set.delete(listener); if (set.size === 0) listeners.delete(sessionId) }
}
