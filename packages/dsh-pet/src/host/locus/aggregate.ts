/**
 * Pure domain types and transitions for the unified Pet locus model.
 *
 * A locus is one generation of the association between a Lark endpoint and a
 * DSH parent/child session pair.  The repository owns indexes and persistence;
 * this module deliberately has no dependency on the retired chat_bindings or
 * QA task model.
 */

export type LocusSource = 'auto' | 'inherited' | 'explicit' | 'qa-created'

export type LocusState =
  | 'provisioning'
  | 'active'
  | 'switching'
  | 'invalid'
  | 'stopped'
  | 'retired'

export type LocusPermissionMode = 'read' | 'write'

/** The normalized address of a Lark chat or a thread inside that chat. */
export interface LocusEndpoint {
  readonly chatId: string
  readonly threadId?: string
}

/** The permission desired by the control plane and the effect verified by Host. */
export interface LocusPermission {
  readonly desired: LocusPermissionMode
  readonly effective: LocusPermissionMode
  readonly verifiedAt?: number
  readonly grantedBy?: string
}

/** A separately confirmed execution anchor; presence is not authorization. */
export interface LocusContextAnchor {
  readonly status: 'confirmed' | 'missing' | 'unknown'
  /** Path existence is an observed fact, never an authorization claim. */
  readonly existence?: 'exists' | 'missing' | 'unknown'
  /** Kept separate from existence; owner confirmation alone leaves this unknown. */
  readonly authorization?: 'authorized' | 'unauthorized' | 'unknown'
  readonly executionRoot?: string
  /** Owner-confirmed project material entry points; not routing or authority. */
  readonly projectResources?: readonly string[]
  readonly constraints?: readonly string[]
  readonly provenance?: string
  readonly confirmedAt?: number
}

/**
 * Durable association record.  A provisioning record may not have a child yet;
 * an active record must have one.  `busy` is a control-plane fence for an
 * accepted/running delivery and prevents a source switch from racing work.
 */
export interface LocusRecord {
  readonly id: string
  readonly generation: number
  /** Durable optimistic revision; omitted only for legacy records. */
  readonly revision?: number
  readonly endpoint: LocusEndpoint
  readonly parentSessionId: string
  readonly childSessionId?: string
  readonly workspaceId: string
  /** Group locus that structurally owns a topic locus, when applicable. */
  readonly parentLocusId?: string
  readonly source: LocusSource
  readonly state: LocusState
  readonly permission: LocusPermission
  readonly contextAnchor?: LocusContextAnchor
  readonly busy: boolean
  readonly createdAt: number
  readonly updatedAt: number
  readonly retiredAt?: number
  readonly stoppedAt?: number
  readonly invalidReason?: string
  readonly replacesLocusId?: string
}

/** Input used to construct a new locus generation. */
export interface NewLocusInput {
  readonly id?: string
  readonly generation?: number
  readonly endpoint: LocusEndpoint
  readonly parentSessionId: string
  readonly childSessionId?: string
  readonly workspaceId: string
  readonly parentLocusId?: string
  readonly source: LocusSource
  readonly state?: LocusState
  readonly permission?: Partial<LocusPermission>
  readonly contextAnchor?: LocusContextAnchor
  readonly busy?: boolean
  readonly revision?: number
  readonly createdAt?: number
  readonly updatedAt?: number
  readonly replacesLocusId?: string
}

/** A normalized endpoint and its stable in-memory/index key. */
export interface NormalizedEndpoint {
  readonly endpoint: LocusEndpoint
  readonly key: string
}

/** Optimistic fence checked against the current locus inside a serialized mutation. */
export interface LocusMutationFence {
  readonly expectedGeneration?: number
  readonly expectedLocusId?: string
  readonly expectedUpdatedAt?: number
  readonly expectedRevision?: number
}

export type LocusErrorCode =
  | 'REVISION_CONFLICT'
  | 'INVALID_ENDPOINT'
  | 'INVALID_LOCUS'
  | 'LOCUS_NOT_FOUND'
  | 'ENDPOINT_OCCUPIED'
  | 'CHILD_OCCUPIED'
  | 'PARENT_WORKSPACE_CONFLICT'
  | 'LOCUS_STOPPED'
  | 'LOCUS_INVALID'
  | 'LOCUS_BUSY'
  | 'REPLACEMENT_REQUIRED'
  | 'EXPLICIT_SOURCE_LOCKED'
  | 'INVALID_STATE'
  | 'INVALID_PERMISSION'
  | 'DEFAULT_QA_CONFLICT'

/** Stable, dependency-free error for deterministic repository callers. */
export class LocusError extends Error {
  readonly code: LocusErrorCode

  constructor(code: LocusErrorCode, message: string) {
    super(message)
    this.name = 'LocusError'
    this.code = code
  }
}

const SOURCES: readonly LocusSource[] = ['auto', 'inherited', 'explicit', 'qa-created']
const STATES: readonly LocusState[] = [
  'provisioning',
  'active',
  'switching',
  'invalid',
  'stopped',
  'retired',
]

/** Whether a source is eligible for an explicit replacement. */
export function isAutomaticSource(source: LocusSource): boolean {
  return source === 'auto' || source === 'inherited'
}

/** Whether a record can be addressed as the endpoint's current generation. */
export function isCurrentLocusState(state: LocusState): boolean {
  // Unavailable generations remain durable history, but they are never an
  // endpoint's routable/current generation.  A stopped or invalid row must be
  // explicitly rebuilt rather than being revived by ensure.
  return !isUnavailableLocusState(state)
}

/** Whether a record is no longer allowed to accept normal messages. */
export function isUnavailableLocusState(state: LocusState): boolean {
  return state === 'invalid' || state === 'stopped' || state === 'retired'
}

/**
 * Normalize a Lark endpoint.  IDs are opaque platform identifiers: trim outer
 * whitespace but never lowercase or otherwise rewrite their case.  Empty
 * thread IDs mean the chat-level endpoint and are omitted from the result.
 */
export function normalizeLocusEndpoint(endpoint: LocusEndpoint): NormalizedEndpoint {
  if (endpoint === null || typeof endpoint !== 'object') {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint must be an object')
  }

  const chatId = typeof endpoint.chatId === 'string' ? endpoint.chatId.trim() : ''
  const rawThreadId = endpoint.threadId
  if (rawThreadId !== undefined && typeof rawThreadId !== 'string') {
    throw new LocusError('INVALID_ENDPOINT', 'threadId must be a string when provided')
  }
  const threadId = rawThreadId === undefined ? undefined : rawThreadId.trim()

  if (chatId.length === 0) {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint requires a non-empty chatId')
  }
  if (chatId.includes('\u0000') || (threadId !== undefined && threadId.includes('\u0000'))) {
    throw new LocusError('INVALID_ENDPOINT', 'Locus endpoint identifiers may not contain NUL')
  }

  const endpointValue: LocusEndpoint =
    threadId === undefined || threadId.length === 0 ? { chatId } : { chatId, threadId }
  return {
    endpoint: endpointValue,
    key: endpointKeyOf(endpointValue),
  }
}

/**
 * Stable endpoint key.  Chat-only endpoints use the chat id itself; a topic
 * appends a NUL separator.  Lark IDs do not contain NUL, so this is reversible
 * and keeps the familiar `chat\u0000thread` form used by the channel seam.
 */
export function endpointKeyOf(endpoint: LocusEndpoint): string {
  const normalized = endpoint === undefined ? undefined : normalizeWithoutKey(endpoint)
  if (normalized === undefined) {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint is required')
  }
  return normalized.threadId === undefined
    ? normalized.chatId
    : `${normalized.chatId}\u0000${normalized.threadId}`
}

/** Alias used by channel code and tests that call this a locus key. */
export const locusKeyOf = endpointKeyOf

/** Parse a stable endpoint key created by {@link endpointKeyOf}. */
export function endpointFromKey(key: string): LocusEndpoint {
  if (typeof key !== 'string' || key.length === 0) {
    throw new LocusError('INVALID_ENDPOINT', 'An endpoint key must be non-empty')
  }
  const separator = key.indexOf('\u0000')
  if (separator < 0) return normalizeLocusEndpoint({ chatId: key }).endpoint
  const chatId = key.slice(0, separator)
  const threadId = key.slice(separator + 1)
  return normalizeLocusEndpoint({ chatId, threadId }).endpoint
}

/** Alias for callers that prefer the key terminology. */
export const parseEndpointKey = endpointFromKey

function normalizeWithoutKey(endpoint: LocusEndpoint): LocusEndpoint {
  if (endpoint === null || typeof endpoint !== 'object') {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint must be an object')
  }
  const chatId = typeof endpoint.chatId === 'string' ? endpoint.chatId.trim() : ''
  const rawThreadId = endpoint.threadId
  if (rawThreadId !== undefined && typeof rawThreadId !== 'string') {
    throw new LocusError('INVALID_ENDPOINT', 'threadId must be a string when provided')
  }
  const threadId = rawThreadId === undefined ? undefined : rawThreadId.trim()
  if (chatId.length === 0) {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint requires a non-empty chatId')
  }
  if (chatId.includes('\u0000') || (threadId !== undefined && threadId.includes('\u0000'))) {
    throw new LocusError('INVALID_ENDPOINT', 'Locus endpoint identifiers may not contain NUL')
  }
  return threadId === undefined || threadId.length === 0 ? { chatId } : { chatId, threadId }
}

/** Compare endpoints after normalization. */
export function sameLocusEndpoint(left: LocusEndpoint, right: LocusEndpoint): boolean {
  return endpointKeyOf(left) === endpointKeyOf(right)
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LocusError('INVALID_LOCUS', `${field} must be a non-empty string`)
  }
}

function assertSource(value: unknown): asserts value is LocusSource {
  if (!SOURCES.includes(value as LocusSource)) {
    throw new LocusError('INVALID_LOCUS', `Unknown locus source '${String(value)}'`)
  }
}

function assertState(value: unknown): asserts value is LocusState {
  if (!STATES.includes(value as LocusState)) {
    throw new LocusError('INVALID_LOCUS', `Unknown locus state '${String(value)}'`)
  }
}

function freezePermission(permission: LocusPermission): LocusPermission {
  return Object.freeze({ ...permission })
}

function freezeEndpoint(endpoint: LocusEndpoint): LocusEndpoint {
  return Object.freeze({ ...endpoint })
}

/**
 * Build and validate a locus record without touching a repository.  Repository
 * writes call this function so every storage adapter receives the same shape.
 */
export function buildLocusRecord(input: NewLocusInput): LocusRecord {
  const normalized = normalizeLocusEndpoint(input.endpoint).endpoint
  assertString(input.parentSessionId, 'parentSessionId')
  assertString(input.workspaceId, 'workspaceId')
  assertSource(input.source)
  const state = input.state ?? 'active'
  assertState(state)
  if (input.childSessionId !== undefined) assertString(input.childSessionId, 'childSessionId')
  if (input.parentLocusId !== undefined) assertString(input.parentLocusId, 'parentLocusId')
  if (input.parentLocusId !== undefined && normalized.threadId === undefined) {
    throw new LocusError('INVALID_LOCUS', 'A parentLocusId is only valid for a topic locus')
  }
  if (normalized.threadId !== undefined && input.parentLocusId === undefined) {
    throw new LocusError('INVALID_LOCUS', 'A topic locus requires a chat-level parentLocusId')
  }
  if (input.replacesLocusId !== undefined) assertString(input.replacesLocusId, 'replacesLocusId')
  if (input.busy !== undefined && typeof input.busy !== 'boolean') {
    throw new LocusError('INVALID_LOCUS', 'busy must be a boolean')
  }
  if (input.busy === true && state !== 'active' && state !== 'switching') {
    throw new LocusError('INVALID_LOCUS', 'Only a serviceable locus may carry a busy fence')
  }

  const generation = input.generation ?? 1
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new LocusError('INVALID_LOCUS', 'generation must be a positive safe integer')
  }

  const createdAt = input.createdAt ?? 0
  const updatedAt = input.updatedAt ?? createdAt
  if (
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    !Number.isSafeInteger(updatedAt) ||
    updatedAt < 0 ||
    updatedAt < createdAt
  ) {
    throw new LocusError('INVALID_LOCUS', 'createdAt and updatedAt must be non-negative ordered safe integers')
  }

  const requestedPermission = input.permission
  const desired = requestedPermission?.desired ?? 'read'
  const effective = requestedPermission?.effective ?? 'read'
  if (desired !== 'read' && desired !== 'write') {
    throw new LocusError('INVALID_PERMISSION', `Unknown desired permission '${String(desired)}'`)
  }
  if (effective !== 'read' && effective !== 'write') {
    throw new LocusError('INVALID_PERMISSION', `Unknown effective permission '${String(effective)}'`)
  }
  if (requestedPermission?.verifiedAt !== undefined &&
      (!Number.isSafeInteger(requestedPermission.verifiedAt) || requestedPermission.verifiedAt < 0)) {
    throw new LocusError('INVALID_PERMISSION', 'verifiedAt must be a non-negative safe integer')
  }
  if (requestedPermission?.grantedBy !== undefined) {
    assertString(requestedPermission.grantedBy, 'grantedBy')
  }
  if (state !== 'active' && effective === 'write') {
    throw new LocusError('INVALID_PERMISSION', 'Only an active locus may have effective write permission')
  }
  if (effective === 'write' && requestedPermission?.verifiedAt === undefined) {
    throw new LocusError('INVALID_PERMISSION', 'Effective write requires a verification timestamp')
  }
  if (effective === 'write' && effective !== desired) {
    throw new LocusError('INVALID_PERMISSION', 'Effective write requires desired write permission')
  }
  if (state === 'active' && input.childSessionId === undefined) {
    throw new LocusError('INVALID_LOCUS', 'An active locus requires a childSessionId')
  }
  const contextAnchor = input.contextAnchor === undefined ? undefined : validateContextAnchor(input.contextAnchor)

  const id = input.id?.trim()
  assertString(id ?? `generated-${generation}`, 'id')
  const permission: LocusPermission = {
    desired,
    effective,
    ...(requestedPermission?.verifiedAt !== undefined
      ? { verifiedAt: requestedPermission.verifiedAt }
      : {}),
    ...(requestedPermission?.grantedBy !== undefined
      ? { grantedBy: requestedPermission.grantedBy }
      : {}),
  }

  const record: LocusRecord = {
    id: id ?? `generated-${generation}`,
    generation,
    endpoint: freezeEndpoint(normalized),
    parentSessionId: input.parentSessionId.trim(),
    ...(input.childSessionId !== undefined ? { childSessionId: input.childSessionId.trim() } : {}),
    workspaceId: input.workspaceId.trim(),
    ...(input.parentLocusId !== undefined ? { parentLocusId: input.parentLocusId.trim() } : {}),
    source: input.source,
    state,
    permission: freezePermission(permission),
    ...(contextAnchor !== undefined ? { contextAnchor } : {}),
    busy: input.busy ?? false,
    ...(input.revision !== undefined ? { revision: input.revision } : {}),
    createdAt,
    updatedAt,
    ...(input.replacesLocusId !== undefined ? { replacesLocusId: input.replacesLocusId.trim() } : {}),
  }
  return Object.freeze(record)
}

function validateContextAnchor(anchor: LocusContextAnchor): LocusContextAnchor {
  if (anchor.status !== 'confirmed' && anchor.status !== 'missing' && anchor.status !== 'unknown') {
    throw new LocusError('INVALID_LOCUS', `Unknown context anchor status '${String(anchor.status)}'`)
  }
  if (anchor.executionRoot !== undefined) assertString(anchor.executionRoot, 'contextAnchor.executionRoot')
  if (anchor.provenance !== undefined) assertString(anchor.provenance, 'contextAnchor.provenance')
  if (anchor.confirmedAt !== undefined && (!Number.isSafeInteger(anchor.confirmedAt) || anchor.confirmedAt < 0)) {
    throw new LocusError('INVALID_LOCUS', 'contextAnchor.confirmedAt must be a non-negative safe integer')
  }
  if (anchor.existence !== undefined && !['exists', 'missing', 'unknown'].includes(anchor.existence)) {
    throw new LocusError('INVALID_LOCUS', 'contextAnchor.existence is invalid')
  }
  if (anchor.authorization !== undefined && !['authorized', 'unauthorized', 'unknown'].includes(anchor.authorization)) {
    throw new LocusError('INVALID_LOCUS', 'contextAnchor.authorization is invalid')
  }
  const projectResources = anchor.projectResources?.map((resource, index) => {
    assertString(resource, `contextAnchor.projectResources[${index}]`)
    return resource.trim()
  })
  const constraints = anchor.constraints?.map((constraint, index) => {
    assertString(constraint, `contextAnchor.constraints[${index}]`)
    return constraint.trim()
  })
  return Object.freeze({
    status: anchor.status,
    ...(anchor.existence !== undefined ? { existence: anchor.existence } : {}),
    ...(anchor.authorization !== undefined ? { authorization: anchor.authorization } : {}),
    ...(anchor.executionRoot !== undefined ? { executionRoot: anchor.executionRoot.trim() } : {}),
    ...(projectResources !== undefined ? { projectResources: Object.freeze(projectResources) } : {}),
    ...(constraints !== undefined ? { constraints: Object.freeze(constraints) } : {}),
    ...(anchor.provenance !== undefined ? { provenance: anchor.provenance.trim() } : {}),
    ...(anchor.confirmedAt !== undefined ? { confirmedAt: anchor.confirmedAt } : {}),
  })
}

/** Check a caller's optimistic fence while the repository mutation is serialized. */
export function assertLocusMutationFence(record: LocusRecord, fence?: LocusMutationFence): void {
  if (fence === undefined) return
  if (fence.expectedLocusId !== undefined && record.id !== fence.expectedLocusId) {
    throw new LocusError('REVISION_CONFLICT', 'locus identity changed')
  }
  if (fence.expectedGeneration !== undefined && record.generation !== fence.expectedGeneration) {
    throw new LocusError('REVISION_CONFLICT', 'locus generation changed')
  }
  if (fence.expectedUpdatedAt !== undefined && record.updatedAt !== fence.expectedUpdatedAt) {
    throw new LocusError('REVISION_CONFLICT', 'locus timestamp changed')
  }
  if (fence.expectedRevision !== undefined && (record.revision ?? 0) !== fence.expectedRevision) {
    throw new LocusError('REVISION_CONFLICT', 'locus revision changed')
  }
}

/** Pure state transition used by repository and storage adapters. */
export function transitionLocus(
  record: LocusRecord,
  state: LocusState,
  now: number,
  patch: Partial<Pick<LocusRecord, 'childSessionId' | 'invalidReason' | 'busy'>> = {},
): LocusRecord {
  assertState(state)
  if (!Number.isSafeInteger(now) || now < 0 || now < record.updatedAt) {
    throw new LocusError('INVALID_STATE', 'transition time must be a non-negative monotonic safe integer')
  }

  if (record.busy && state !== record.state) {
    throw new LocusError('LOCUS_BUSY', `A busy locus cannot transition from ${record.state} to ${state}`)
  }

  const nextChild = patch.childSessionId ?? record.childSessionId
  if (state === 'active' && nextChild === undefined) {
    throw new LocusError('INVALID_STATE', 'An active locus requires a childSessionId')
  }
  if (state === 'active' && record.state === 'retired') {
    throw new LocusError('INVALID_STATE', 'A retired locus cannot become active again')
  }
  if (state === 'active' && record.state === 'stopped') {
    throw new LocusError('INVALID_STATE', 'A stopped locus cannot become active again')
  }
  if (state === 'active' && record.state === 'invalid') {
    throw new LocusError('INVALID_STATE', 'An invalid locus cannot become active again')
  }
  if (state !== record.state && record.state === 'retired') {
    throw new LocusError('INVALID_STATE', 'A retired locus cannot transition without explicit rebuild')
  }
  const legal: Readonly<Record<LocusState, readonly LocusState[]>> = {
    provisioning: ['active', 'invalid', 'stopped', 'retired'],
    active: ['active', 'switching', 'invalid', 'stopped', 'retired'],
    switching: ['active', 'invalid', 'stopped', 'retired'],
    invalid: ['invalid', 'retired'],
    stopped: ['stopped', 'retired'],
    retired: ['retired'],
  }
  if (!legal[record.state].includes(state)) {
    throw new LocusError('INVALID_STATE', `Cannot transition locus from ${record.state} to ${state}`)
  }
  const unavailable = state === 'invalid' || state === 'stopped' || state === 'retired'
  const nextPermission: LocusPermission = unavailable
    ? { ...record.permission, effective: 'read' }
    : record.permission

  const next: LocusRecord = {
    ...record,
    ...(nextChild !== undefined ? { childSessionId: nextChild } : {}),
    state,
    permission: freezePermission(nextPermission),
    busy: unavailable ? false : patch.busy ?? record.busy,
    revision: (record.revision ?? 0) + 1,
    updatedAt: now,
    ...(patch.invalidReason !== undefined ? { invalidReason: patch.invalidReason } : {}),
    ...(state === 'stopped' ? { stoppedAt: now } : {}),
    ...(state === 'retired' ? { retiredAt: now } : {}),
  }
  return Object.freeze(next)
}

/** Replace only the permission projection, preserving the association identity. */
export function withLocusPermission(
  record: LocusRecord,
  permission: LocusPermission,
  now: number,
  options: { readonly allowSwitching?: boolean } = {},
): LocusRecord {
  if (!Number.isSafeInteger(now) || now < 0 || now < record.updatedAt) {
    throw new LocusError('INVALID_PERMISSION', 'permission time must be a non-negative monotonic safe integer')
  }
  if (
    record.state === 'retired' ||
    record.state === 'stopped' ||
    record.state === 'invalid' ||
    (record.state === 'switching' && options.allowSwitching !== true)
  ) {
    throw new LocusError('INVALID_PERMISSION', 'An unavailable locus cannot change permission')
  }
  if (permission.effective === 'write' && permission.desired !== 'write') {
    throw new LocusError('INVALID_PERMISSION', 'Effective write requires desired write permission')
  }
  if (permission.effective === 'write' && permission.verifiedAt === undefined) {
    throw new LocusError('INVALID_PERMISSION', 'Effective write requires a verification timestamp')
  }
  return Object.freeze({
    ...record,
    permission: freezePermission(permission),
    revision: (record.revision ?? 0) + 1,
    updatedAt: now,
  })
}

/** Return a record with its mutable control fence changed. */
export function withLocusBusy(record: LocusRecord, busy: boolean, now: number): LocusRecord {
  if (!Number.isSafeInteger(now) || now < 0 || now < record.updatedAt) {
    throw new LocusError('INVALID_STATE', 'busy time must be a non-negative monotonic safe integer')
  }
  if (busy && record.state !== 'active' && record.state !== 'switching') {
    throw new LocusError('INVALID_STATE', `Unavailable locus ${record.id} cannot carry a busy fence`)
  }
  return Object.freeze({ ...record, busy, revision: (record.revision ?? 0) + 1, updatedAt: now })
}
