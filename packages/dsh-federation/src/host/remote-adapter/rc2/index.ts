import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import {
  encodeSessionId,
  encodeWorkspaceId,
  type AbortOptions,
  type DshNodePort,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeCapability,
  type NodeDescriptor,
  type PromptCommand,
  type RpcId,
  type SearchQuery,
  type SearchResult,
  type SessionProjection,
  type WorkspaceProjection,
} from '../../../core/index.js'
import { CarrierError, isDualStreamReadiness, type DualStreamReadiness, type EventStreamKind, type Rc2UnaryTransport } from '../../carrier/index.js'
import { sendAttemptOf } from '../../send-attempt.js'
import {
  attachmentValue, directoryCreatedValue, directoryListingValue, historyValue, hostDescription,
  modelsValue, object, renameValue, searchValue, selectedModelValue, sessionIdValue, sessionList,
  string, stringListValue, trueReceipt, workspaceList, workspaceValue,
  type Rc2SessionList, type Rc2WorkspaceList,
} from './schema.js'
import type { ReconciliationFrame } from '../../../core/reconciliation.js'

export type Rc2StableEvent =
  | { readonly kind: 'reconciliation'; readonly frame: ReconciliationFrame<WorkspaceProjection, { readonly running: boolean }, unknown> }
  | { readonly kind: 'interaction'; readonly rpcId: RpcId; readonly sessionId: NativeSessionId; readonly interaction: 'approval' | 'question'; readonly payload: unknown }
  | { readonly kind: 'control'; readonly stream: EventStreamKind; readonly payload: unknown }
  | { readonly kind: 'refresh-required'; readonly reason: string }

/**
 * Versions rc.2's own `host.describe` may report for a verified rc.2 deployment.
 *
 * The contract comment promises the apps/cli version, but the pinned rc.2
 * implementation hardcodes `version: "0.0.1"`
 * (`dsh-host-apiproxy/lib/index.js:3110`), verified against a real `dsh web` in
 * an isolated DSH_HOME. Gating writes on an exact `0.1.1-rc.2` string would
 * therefore withhold writes from every genuine rc.2 node, so the reported
 * version alone is treated as advisory and structural proof decides.
 */
const RC2_ADVERTISED_VERSIONS: ReadonlySet<string> = new Set(['0.1.1-rc.2', '0.0.1'])
/** Every rc.2 method this adapter may ever send. Anything absent is unreachable by construction. */
export const RC2_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'host.describe', 'host.listDirectory', 'host.createDirectory',
  'workspace.list', 'workspace.create', 'workspace.rename', 'workspace.delete',
  'workspace.insertBefore', 'workspace.insertSessionBefore', 'workspace.archiveSession',
  'session.list', 'session.create', 'session.history', 'session.models', 'session.selectModel',
  'session.rename', 'session.fork', 'session.prompt', 'session.attachment', 'session.updateQueue',
  'session.cancel', 'session.search',
])
/** rc.2 surfaces federation must never route to a remote node. */
export const RC2_FORBIDDEN_METHODS: readonly string[] = [
  'host.openPath', 'host.pickDirectory', 'session.export',
  'settings.describe', 'settings.update', 'settings.replace', 'settings.mutate', 'settings.openDocument',
  'credentials.describe', 'credentials.set', 'credentials.unset',
  'llm.providers', 'llm.models', 'llm.discoverModels',
]
const FULL_CAPABILITIES = new Set<NodeCapability>([
  'workspace.read', 'workspace.write', 'session.read', 'session.write', 'session.search',
  'session.attachment', 'directory.read', 'directory.write', 'events.mux', 'events.host',
  'interaction.respond',
])
const READ_ONLY_CAPABILITIES = new Set<NodeCapability>([
  'workspace.read', 'session.read', 'session.search', 'session.attachment', 'directory.read', 'events.mux', 'events.host',
])
const UNARY_CAPABILITIES = new Set<NodeCapability>([
  'workspace.read', 'session.read', 'session.search', 'session.attachment', 'directory.read',
])

export type Rc2EventEnvelope = ReturnType<typeof serverRequestSchema.parse>

/**
 * Applies rc.2's own two-level wire validation: first the full server-request
 * envelope, then the payload union owned by the physical stream. Method and
 * payload discriminator must agree so an envelope cannot be reclassified after
 * validation.
 */
export function validateRc2EventEnvelope(stream: EventStreamKind, value: unknown): Rc2EventEnvelope {
  const envelope = serverRequestSchema.parse(value)
  const payload = (stream === 'mux' ? muxFrameSchema : hostFrameSchema).parse(envelope.payload)
  if (envelope.method !== payload.type) throw new Error(`${stream} event method does not match payload.type`)
  return { ...envelope, payload }
}

export interface Rc2ProbeResult {
  readonly compatibility: 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'
  readonly version: string
  readonly capabilities: ReadonlySet<NodeCapability>
  readonly diagnostic: string
}

export class RemoteBusinessError extends Error {
  constructor(readonly method: string, readonly remoteError: unknown) {
    super(`remote DSH rejected ${method}`)
    this.name = 'RemoteBusinessError'
  }
}

export class DshRc2NodeAdapter implements DshNodePort {
  readonly node: NodeDescriptor
  readonly capabilities: ReadonlySet<NodeCapability>
  readonly #carrier: Rc2UnaryTransport
  readonly #workspaceBySession = new Map<string, NativeWorkspaceId>()
  readonly #archivedSessions = new Set<string>()
  readonly #sessions = new Map<string, SessionProjection>()
  /** Set once this deployment refuses content search at call time. */
  #searchDisabled = false
  #rpcCounter = 0

  constructor(node: NodeDescriptor, carrier: Rc2UnaryTransport, capabilities: ReadonlySet<NodeCapability>) {
    this.node = node
    this.#carrier = carrier
    this.capabilities = new Set(capabilities)
  }

  static async probeUnary(carrier: Rc2UnaryTransport, options?: AbortOptions): Promise<Rc2ProbeResult> {
    return this.#probe(carrier, undefined, options)
  }

  static finalizeProbe(unary: Rc2ProbeResult, streams: DualStreamReadiness): Rc2ProbeResult {
    if (!isDualStreamReadiness(streams) || !streams.opened.has('mux') || !streams.opened.has('host')) {
      return { ...unary, compatibility: 'INCOMPATIBLE', capabilities: new Set(), diagnostic: 'both rc.2 event streams must open successfully' }
    }
    const optional = {
      search: unary.capabilities.has('session.search'),
      browse: unary.capabilities.has('directory.read'),
    }
    const capabilities = unary.compatibility === 'SUPPORTED'
      ? applyOptional(FULL_CAPABILITIES, optional)
      : unary.compatibility === 'EXPERIMENTAL'
        ? applyOptional(READ_ONLY_CAPABILITIES, optional)
        : new Set<NodeCapability>()
    return { ...unary, capabilities, diagnostic: unary.diagnostic.replace('unary probe; streams not yet authoritative', 'structural probe') }
  }

  static async probe(carrier: Rc2UnaryTransport, streams: DualStreamReadiness, options?: AbortOptions): Promise<Rc2ProbeResult> {
    return this.finalizeProbe(await this.#probe(carrier, undefined, options), streams)
  }

  static async #probe(carrier: Rc2UnaryTransport, streams: DualStreamReadiness | undefined, options?: AbortOptions): Promise<Rc2ProbeResult> {
    const description = hostDescription(await rpc(carrier, 'host.describe', {}, 'probe-host', options))
    if (streams !== undefined && (!isDualStreamReadiness(streams) || !streams.opened.has('mux') || !streams.opened.has('host'))) {
      return { compatibility: 'INCOMPATIBLE', version: description.version, capabilities: new Set(), diagnostic: 'both rc.2 event streams must open successfully' }
    }
    try {
      workspaceList(await rpc(carrier, 'workspace.list', {}, 'probe-workspaces', options))
      sessionList(await rpc(carrier, 'session.list', {}, 'probe-sessions', options))
    } catch (cause) {
      return { compatibility: 'INCOMPATIBLE', version: description.version, capabilities: new Set(), diagnostic: cause instanceof Error ? `core baseline probe failed: ${cause.message}` : 'core baseline probe failed' }
    }
    // `session.search` is deployment-configurable (the sqlite session-query
    // index can be opened "never"), so its absence is an optional-capability
    // fact rather than an incompatibility.
    const optional = await probeOptionalCapabilities(carrier, options)
    const notes = [
      optional.search ? 'content search available' : 'content search disabled by this deployment',
      optional.browse ? 'directory browse available' : 'directory browse not served by this deployment',
    ].join('; ')
    const streamsVerified = streams !== undefined
    if (!RC2_ADVERTISED_VERSIONS.has(description.version)) {
      return {
        compatibility: 'EXPERIMENTAL', version: description.version,
        capabilities: applyOptional(streamsVerified ? READ_ONLY_CAPABILITIES : UNARY_CAPABILITIES, optional),
        diagnostic: `unverified version; only live-probed read capabilities enabled (${notes})`,
      }
    }
    return {
      compatibility: 'SUPPORTED', version: description.version,
      capabilities: applyOptional(streamsVerified ? FULL_CAPABILITIES : UNARY_CAPABILITIES, optional),
      diagnostic: `${streamsVerified ? 'verified rc.2 structural probe' : 'verified rc.2 unary probe; streams not yet authoritative'}; ${notes}`,
    }
  }

  async listWorkspaces(options?: AbortOptions): Promise<readonly WorkspaceProjection[]> {
    return this.#projectWorkspaces(workspaceList(await this.#call('workspace.list', {}, options)))
  }

  async createWorkspace(path: string, options?: AbortOptions): Promise<WorkspaceProjection> {
    const workspace = workspaceValue(await this.#call('workspace.create', { path }, options), 'workspace.create')
    return this.#projectWorkspaces({ items: [workspace], archivedSessionIds: [] })[0]!
  }

  async renameWorkspace(workspaceId: NativeWorkspaceId, title: string, options?: AbortOptions): Promise<WorkspaceProjection> {
    const workspace = workspaceValue(await this.#call('workspace.rename', { workspaceId, title }, options), 'workspace.rename')
    return this.#projectWorkspaces({ items: [workspace], archivedSessionIds: [] })[0]!
  }

  async deleteWorkspace(workspaceId: NativeWorkspaceId, options?: AbortOptions): Promise<void> { trueReceipt(await this.#call('workspace.delete', { workspaceId }, options), 'workspace.delete', 'deleted') }
  async reorderWorkspace(workspaceId: NativeWorkspaceId, beforeId: NativeWorkspaceId | undefined, options?: AbortOptions): Promise<void> { stringListValue(await this.#call('workspace.insertBefore', { workspaceId, ...(beforeId === undefined ? {} : { beforeWorkspaceId: beforeId }) }, options), 'workspace.insertBefore', 'workspaceIds') }
  async reorderSession(workspaceId: NativeWorkspaceId, sessionId: NativeSessionId, beforeId: NativeSessionId | undefined, options?: AbortOptions): Promise<void> {
    workspaceValue(await this.#call('workspace.insertSessionBefore', {
      workspaceId, sessionId, ...(beforeId === undefined ? {} : { beforeSessionId: beforeId }),
    }, options), 'workspace.insertSessionBefore')
  }

  async listSessions(options?: AbortOptions): Promise<readonly SessionProjection[]> {
    return this.#projectSessions(sessionList(await this.#call('session.list', {}, options)))
  }

  async createSession(workspaceId: NativeWorkspaceId | undefined, options?: AbortOptions): Promise<NativeSessionId> {
    return sessionIdValue(await this.#call('session.create', workspaceId === undefined ? {} : { workspaceId }, options), 'session.create') as NativeSessionId
  }

  async history(sessionId: NativeSessionId, options?: AbortOptions & { readonly beforeSeq?: number }): Promise<unknown> { return historyValue(await this.#call('session.history', { sessionId, ...(options?.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }) }, options)) }
  async models(sessionId: NativeSessionId, options?: AbortOptions): Promise<unknown> { return modelsValue(await this.#call('session.models', { sessionId }, options)) }
  async prompt(command: PromptCommand, options?: AbortOptions): Promise<void> {
    const { rpcId, ...payload } = command
    trueReceipt(await this.#call('session.prompt', payload, options, rpcId), 'session.prompt')
  }
  async cancel(sessionId: NativeSessionId, options?: AbortOptions): Promise<void> { trueReceipt(await this.#call('session.cancel', { sessionId }, options), 'session.cancel') }
  async renameSession(sessionId: NativeSessionId, title: string, options?: AbortOptions): Promise<{ readonly title: string; readonly seq: number }> { return renameValue(await this.#call('session.rename', { sessionId, title }, options)) }
  async forkSession(sessionId: NativeSessionId, atSeq: number | undefined, options?: AbortOptions): Promise<NativeSessionId> {
    return sessionIdValue(await this.#call('session.fork', { sessionId, ...(atSeq === undefined ? {} : { atSeq }) }, options), 'session.fork') as NativeSessionId
  }
  async selectModel(sessionId: NativeSessionId, selection: unknown, options?: AbortOptions): Promise<unknown> { return selectedModelValue(await this.#call('session.selectModel', { sessionId, ...object(selection, 'model selection') }, options)) }
  async updateQueue(sessionId: NativeSessionId, update: unknown, options?: AbortOptions): Promise<void> { trueReceipt(await this.#call('session.updateQueue', { sessionId, ...object(update, 'queue update') }, options), 'session.updateQueue') }
  async attachment(sessionId: NativeSessionId, attachmentId: string, options?: AbortOptions): Promise<unknown> { return attachmentValue(await this.#call('session.attachment', { sessionId, attachmentId }, options)) }

  async search(query: SearchQuery, options?: AbortOptions): Promise<readonly SearchResult[]> {
    // A deployment with its query index closed simply contributes no content
    // hits; the federated search must not fail because of one such node.
    if (!this.capabilities.has('session.search') || this.#searchDisabled) return []
    let raw: unknown
    try {
      raw = await this.#call('session.search', { query: query.query }, options)
    } catch (cause) {
      // Search availability is state-dependent: the sqlite query index may be
      // configured to open "never", which only surfaces once it must actually
      // open. Treat the deployment's own refusal as a lost optional capability
      // rather than a node failure, and stop asking this node.
      if (cause instanceof RemoteBusinessError) {
        this.#searchDisabled = true
        return []
      }
      throw cause
    }
    const value = searchValue(raw)
    return value.items.slice(0, query.limit).map(item => {
      const session = this.#sessions.get(item.sessionId)
      if (session === undefined) throw new CarrierError('Protocol', `search returned session absent from session.list baseline: ${item.sessionId}`, false)
      return { session, snippet: item.snippet }
    })
  }

  async archiveSession(sessionId: NativeSessionId, options?: AbortOptions): Promise<void> { stringListValue(await this.#call('workspace.archiveSession', { sessionId }, options), 'workspace.archiveSession', 'archivedSessionIds') }
  async respond(rpcId: RpcId, response: unknown, options?: AbortOptions): Promise<void> {
    const value = object(response, 'client response')
    const receipt = object(await this.#carrier.request({
      path: '/api/respond', method: 'POST',
      body: { type: 'client-response', rpcId, ...value },
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    }), 'respond receipt')
    if (receipt.accepted !== true) throw new RemoteBusinessError('respond', receipt)
  }
  async listDirectory(path: string | undefined, options?: AbortOptions): Promise<unknown> { return directoryListingValue(await this.#call('host.listDirectory', path === undefined ? {} : { path }, options)) }
  async createDirectory(path: string, name: string, options?: AbortOptions): Promise<unknown> { return directoryCreatedValue(await this.#call('host.createDirectory', { path, name }, options)) }

  convertFrame(stream: EventStreamKind, value: unknown): Rc2StableEvent {
    const envelope = object(value, `${stream} frame`)
    if (envelope.type !== 'server-request') throw new Error(`${stream} frame type must be server-request`)
    const rpcId = string(envelope.rpcId, `${stream} rpcId`) as RpcId
    const payload = object(envelope.payload, `${stream} payload`)
    const type = string(payload.type, `${stream} payload.type`)
    if (stream === 'mux' && type.startsWith('host/')) throw new Error('host frame arrived on mux stream')
    if (stream === 'host' && !type.startsWith('host/') && type !== 'stream/error') throw new Error('mux frame arrived on host stream')
    if (type === 'session/event' || type === 'session/projection') {
      const sessionId = string(payload.sessionId, `${type}.sessionId`) as NativeSessionId
      const seq = type === 'session/projection'
        ? Number(payload.seq)
        : Number(object(payload.event, 'session/event.event').seq)
      if (!Number.isSafeInteger(seq)) throw new Error(`${type}.seq must be an integer`)
      return { kind: 'reconciliation', frame: { domain: 'session', sessionId, seq, value: payload } }
    }
    if (type === 'host/workspace-changed') {
      const workspace = workspaceValue({ workspace: payload.workspace }, 'host/workspace-changed')
      for (const [sessionId, owner] of this.#workspaceBySession) {
        if (owner === workspace.workspaceId) this.#workspaceBySession.delete(sessionId)
      }
      for (const sessionId of workspace.sessionIds) this.#workspaceBySession.set(sessionId, workspace.workspaceId as NativeWorkspaceId)
      const projected = this.#projectWorkspace(workspace, 0)
      return { kind: 'reconciliation', frame: { domain: 'workspace-upsert', workspaceId: workspace.workspaceId as NativeWorkspaceId, value: projected } }
    }
    if (type === 'host/workspace-removed') return { kind: 'reconciliation', frame: { domain: 'workspace-remove', workspaceId: string(payload.workspaceId, `${type}.workspaceId`) as NativeWorkspaceId } }
    if (type === 'host/session-status') return { kind: 'reconciliation', frame: { domain: 'status', sessionId: string(payload.sessionId, `${type}.sessionId`) as NativeSessionId, value: { running: payload.running === true } } }
    if (type === 'host/session-removed') return { kind: 'reconciliation', frame: { domain: 'status-remove', sessionId: string(payload.sessionId, `${type}.sessionId`) as NativeSessionId } }
    if (type === 'approval/requested' || type === 'question/requested') {
      return {
        kind: 'interaction', rpcId,
        sessionId: string(payload.sessionId, `${type}.sessionId`) as NativeSessionId,
        interaction: type === 'approval/requested' ? 'approval' : 'question', payload,
      }
    }
    if (type === 'host/workspace-order-changed' || type === 'host/archived-sessions-changed' || type === 'host/session-added') return { kind: 'refresh-required', reason: type }
    return { kind: 'control', stream, payload }
  }

  async #call(method: string, payload: unknown, options?: AbortOptions, rpcId?: RpcId): Promise<unknown> {
    return rpc(this.#carrier, method, payload, rpcId ?? `fed-${++this.#rpcCounter}`, options)
  }

  #projectWorkspaces(value: Rc2WorkspaceList): readonly WorkspaceProjection[] {
    this.#workspaceBySession.clear()
    this.#archivedSessions.clear()
    for (const sessionId of value.archivedSessionIds) this.#archivedSessions.add(sessionId)
    for (const workspace of value.items) for (const sessionId of workspace.sessionIds) this.#workspaceBySession.set(sessionId, workspace.workspaceId as NativeWorkspaceId)
    return value.items.map((workspace, order) => this.#projectWorkspace(workspace, order))
  }

  #projectWorkspace(workspace: Rc2WorkspaceList['items'][number], order: number): WorkspaceProjection {
    const archived = this.#archivedSessions
    return {
      ref: { nodeId: this.node.nodeId, nativeId: workspace.workspaceId as NativeWorkspaceId },
      id: encodeWorkspaceId({ nodeId: this.node.nodeId, nativeId: workspace.workspaceId as NativeWorkspaceId }),
      title: workspace.title,
      path: workspace.path,
      sessionIds: workspace.sessionIds.filter(id => !archived.has(id)).map(id => encodeSessionId({ nodeId: this.node.nodeId, nativeId: id as NativeSessionId })),
      archivedSessionIds: workspace.sessionIds.filter(id => archived.has(id)).map(id => encodeSessionId({ nodeId: this.node.nodeId, nativeId: id as NativeSessionId })),
      order,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }
  }

  #projectSessions(value: Rc2SessionList): readonly SessionProjection[] {
    this.#sessions.clear()
    const projections = value.items.map(session => {
      const nativeId = session.sessionId as NativeSessionId
      const workspaceId = this.#workspaceBySession.get(session.sessionId)
      const titleValue = session.projections?.values.title
      return {
        ref: { nodeId: this.node.nodeId, nativeId },
        id: encodeSessionId({ nodeId: this.node.nodeId, nativeId }),
        ...(workspaceId === undefined ? {} : { workspaceId: encodeWorkspaceId({ nodeId: this.node.nodeId, nativeId: workspaceId }) }),
        title: typeof titleValue === 'string' ? titleValue : '',
        path: session.cwd ?? '',
        status: session.running ? 'running' : 'idle',
        ...(session.projections === undefined ? {} : { seq: session.projections.asOfSeq }),
        archived: this.#archivedSessions.has(session.sessionId),
        blank: session.blank,
        updatedAt: session.updatedAt,
      }
    })
    for (const projection of projections) this.#sessions.set(projection.ref.nativeId, projection)
    return projections
  }
}

/** Applies probed optional capabilities to a base capability set. */
function applyOptional(base: ReadonlySet<NodeCapability>, optional: OptionalCapabilities): ReadonlySet<NodeCapability> {
  const capabilities = new Set(base)
  for (const [capability, available] of [
    ['session.search', optional.search],
    ['directory.read', optional.browse],
    ['directory.write', optional.browse],
  ] as const) {
    if (available) capabilities.add(capability)
    else capabilities.delete(capability)
  }
  return capabilities
}

interface OptionalCapabilities {
  /** Session content search; disabled when the query index opens "never". */
  readonly search: boolean
  /** In-app directory browse; requires the remote's composed picker to be "browse". */
  readonly browse: boolean
}

/**
 * Probes one deployment-configurable rc.2 surface.
 *
 * A remote business error is the deployment's own "not served here" answer, so
 * it maps to an absent optional capability. Transport/protocol faults still
 * propagate, because they are not capability answers.
 */
async function probeOptional(carrier: Rc2UnaryTransport, method: string, payload: unknown, rpcId: string, validate: (value: unknown) => unknown, options?: AbortOptions): Promise<boolean> {
  try {
    validate(await rpc(carrier, method, payload, rpcId, options))
    return true
  } catch (cause) {
    if (cause instanceof RemoteBusinessError) return false
    throw cause
  }
}

async function probeOptionalCapabilities(carrier: Rc2UnaryTransport, options?: AbortOptions): Promise<OptionalCapabilities> {
  const [search, browse] = await Promise.all([
    probeOptional(carrier, 'session.search', { query: 'dsh-federation-capability-probe' }, 'probe-search', searchValue, options),
    probeOptional(carrier, 'host.listDirectory', {}, 'probe-browse', directoryListingValue, options),
  ])
  return { search, browse }
}

async function rpc(carrier: Rc2UnaryTransport, method: string, payload: unknown, rpcId: string, options?: AbortOptions): Promise<unknown> {
  if (!RC2_ALLOWED_METHODS.has(method)) throw new CarrierError('Protocol', `federation refuses to call non-allowlisted rc.2 method ${method}`, false)
  const onSendAttempt = sendAttemptOf(options)
  const response = object(await carrier.request({
    path: `/api/${method}`,
    method: 'POST',
    body: { type: 'client-request', rpcId, method, payload },
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(onSendAttempt === undefined ? {} : { onSendAttempt }),
  }), `${method} response`)
  if (response.type !== 'server-response' || response.rpcId !== rpcId) throw new CarrierError('Protocol', `${method} response envelope mismatch`, false)
  const result = object(response.result, `${method} result`)
  if (result.ok === true) return result.value
  if (result.ok === false) throw new RemoteBusinessError(method, result.error)
  throw new CarrierError('Protocol', `${method} result is missing ok`, false)
}
