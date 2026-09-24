/**
 * Shared identity resolver for public context and inquiries. It registers no tools
 * and grants no execution authority. All inputs come from Host-owned adapters;
 * callers must resolve again before dispatch, never retain this as a capability.
 */
import type { LocusEndpoint, LocusRecord } from '../locus/aggregate.js'

/** Only cold durable identity, not the live Agent registry or a model claim. */
export interface CollaborationSessionIdentity {
  readonly id: string
  readonly parentSessionId?: string
}

/** Structural subset already implemented by DurableLocusRepository. */
export interface CollaborationLocusLookup {
  findByChildSessionId(id: string): readonly LocusRecord[]
  getLocusByChild(id: string): LocusRecord | undefined
  listLociByParent(id: string): readonly LocusRecord[]
  getCurrentLocus(endpoint: LocusEndpoint): LocusRecord | undefined
}

export interface CollaborationCallerPorts {
  readonly loci: CollaborationLocusLookup
  readonly inspect: (id: string) => Promise<CollaborationSessionIdentity | undefined>
  /** Synchronous durable archive projection; unavailable/throwing fails closed. */
  readonly isArchived: (id: string) => boolean
  /** Existing shared record only. This resolver never creates a record. */
  readonly hasPublicContext: (parentSessionId: string) => boolean
}

export interface CollaborationChildReference {
  readonly sessionId: string
  readonly locusId: string
  readonly generation: number
}

export interface CollaborationCaller {
  readonly callerSessionId: string
  readonly parentSessionId: string
  readonly role: 'parent' | 'child'
  readonly callerLocus?: CollaborationChildReference
  /** Persistently attached candidates, NOT proof of cold recoverability/reachability. */
  readonly children: readonly CollaborationChildReference[]
}

export class CollaborationUnavailableError extends Error {
  readonly code = 'COLLABORATION_UNAVAILABLE'
  constructor() {
    // Never include underlying index IDs, paths, exception causes or foreign state.
    super('No current collaboration scope is available for this caller.')
    this.name = 'CollaborationUnavailableError'
  }
}

function reject(): never { throw new CollaborationUnavailableError() }
function validId(id: string): boolean { return typeof id === 'string' && id.length > 0 && id.trim() === id }

function identity(row: LocusRecord): string {
  return JSON.stringify([
    row.id, row.generation, row.parentSessionId, row.childSessionId,
    row.endpoint.chatId, row.endpoint.threadId, row.workspaceId,
    row.state,
  ])
}

function reference(row: LocusRecord): CollaborationChildReference {
  if (!validId(row.id) || !validId(row.childSessionId ?? '') || !Number.isSafeInteger(row.generation) || row.generation < 1) reject()
  return Object.freeze({ sessionId: row.childSessionId!, locusId: row.id, generation: row.generation })
}

function assertCurrent(row: LocusRecord, loci: CollaborationLocusLookup): void {
  if (row.state !== 'active' || !validId(row.parentSessionId)) reject()
  reference(row)
  const current = loci.getCurrentLocus(row.endpoint)
  const reverse = loci.getLocusByChild(row.childSessionId!)
  if (current === undefined || reverse === undefined || identity(current) !== identity(row) || identity(reverse) !== identity(row)) reject()
  const all = loci.findByChildSessionId(row.childSessionId!)
  if (all.length !== 1 || identity(all[0]!) !== identity(row)) reject()
}

interface Snapshot {
  readonly result: CollaborationCaller
  readonly fingerprint: string
}

/** Synchronous reads are one event-loop observation; no external awaits here. */
function snapshot(caller: string, ports: CollaborationCallerPorts): Snapshot {
  if (!validId(caller) || ports.isArchived(caller)) reject()
  const { loci } = ports
  const matches = loci.findByChildSessionId(caller)
  if (matches.length > 1) reject()
  const owned = matches[0]
  // A reverse-index entry without its durable lossless record is corruption.
  if (owned === undefined && loci.getLocusByChild(caller) !== undefined) reject()
  if (owned !== undefined) {
    if (owned.childSessionId !== caller) reject()
    assertCurrent(owned, loci)
    // Locus is two levels, not a nested collaboration hierarchy.
    if (loci.listLociByParent(caller).length > 0) reject()
  }
  const parent = owned?.parentSessionId ?? caller
  if (!validId(parent) || ports.isArchived(parent)) reject()
  if (parent !== caller && (loci.findByChildSessionId(parent).length !== 0 || loci.getLocusByChild(parent) !== undefined)) reject()
  const rows = loci.listLociByParent(parent)
  if (rows.some(row => row.parentSessionId !== parent)) reject()
  const active = rows.filter(row => row.state === 'active')
  const ids = new Set<string>()
  const children: CollaborationChildReference[] = []
  for (const row of active) {
    // The durable repository projects an active replacement as switching until
    // its notice is acknowledged. That is a valid unavailable sibling, not
    // index corruption and not a reason to deny all healthy circle callers.
    const projected = loci.getCurrentLocus(row.endpoint)
    if (projected?.state === 'switching' && identity({ ...projected, state: 'active' }) === identity(row)) continue
    assertCurrent(row, loci)
    if (row.childSessionId === parent || ids.has(row.childSessionId!)) reject()
    ids.add(row.childSessionId!)
    if (!ports.isArchived(row.childSessionId!)) children.push(reference(row))
  }
  if (owned !== undefined && !active.some(row => identity(row) === identity(owned))) reject()
  const established = ports.hasPublicContext(parent)
  if (owned === undefined && children.length === 0 && !established) reject()
  children.sort((a, b) => a.locusId.localeCompare(b.locusId))
  const result: CollaborationCaller = Object.freeze({
    callerSessionId: caller, parentSessionId: parent, role: owned === undefined ? 'parent' : 'child',
    ...(owned === undefined ? {} : { callerLocus: reference(owned) }),
    children: Object.freeze(children),
  })
  return {
    result,
    fingerprint: JSON.stringify([result, established, rows.map(identity).sort()]),
  }
}

/**
 * Resolve actual caller then cold-check lineage; reobserve after all awaits.
 * Cold identity is immutable session metadata; archive/association state is not.
 * Any storage error or concurrent relationship change gives the same safe denial.
 */
export function resolveCollaborationCaller(
  callerSessionId: string,
  ports: CollaborationCallerPorts,
): Promise<CollaborationCaller> {
  return readForCollaborationCaller(callerSessionId, ports, caller => caller)
}

/** Execute a synchronous read at the final identity fence, with no microtask gap. */
export async function readForCollaborationCaller<T>(
  callerSessionId: string,
  ports: CollaborationCallerPorts,
  read: (caller: CollaborationCaller) => T,
): Promise<T> {
  try {
    const before = snapshot(callerSessionId, ports)
    const { parentSessionId, role } = before.result
    const [caller, parent] = await Promise.all([
      ports.inspect(callerSessionId),
      role === 'parent' ? Promise.resolve(undefined) : ports.inspect(parentSessionId),
    ])
    if (caller?.id !== callerSessionId) reject()
    if (role === 'parent') {
      if (caller.parentSessionId !== undefined) reject()
    } else {
      if (caller.parentSessionId !== parentSessionId || parent?.id !== parentSessionId || parent.parentSessionId !== undefined) reject()
    }
    const after = snapshot(callerSessionId, ports)
    if (before.fingerprint !== after.fingerprint) reject()
    return read(after.result)
  } catch {
    throw new CollaborationUnavailableError()
  }
}
