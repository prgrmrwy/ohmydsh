/**
 * Explicit read adapter from the controller repository port to durable locus
 * persistence.
 *
 * The two repositories intentionally do not share a record shape.  In
 * particular, durable records use `id`, a verified permission object, and have
 * no independent group row.  This adapter therefore projects every field
 * explicitly instead of relying on structural casts.
 *
 * Provisioning writes delegate only to the durable repository's atomic
 * controller primitives. That repository rejects `beginProvisioning` before
 * any external creation when its Domain has no real transaction capability;
 * this adapter never chains ordinary mutations into a false success.
 */

import {
  buildLocusRecord,
  endpointKeyOf,
  type LocusRecord as DurableLocusRecord,
  type LocusState as DurableLocusState,
} from './aggregate.js'
import type {
  LocusEndpoint as ControllerLocusEndpoint,
  LocusGroupRecord as ControllerLocusGroupRecord,
  LocusMainRecord as ControllerLocusMainRecord,
  LocusMainSource,
  LocusProvisioningCommit,
  LocusRegenerationCommit,
  LocusProvisioningRecord,
  LocusRecord as ControllerLocusRecord,
  LocusRepository as ControllerLocusRepository,
  LocusSource as ControllerLocusSource,
  LocusState as ControllerLocusState,
} from './controller.js'
import type {
  DurableProvisioningCommit,
  DurableRegenerationCommit,
  LocusRepository as DurableLocusRepository,
} from './persistence.js'
import type { PetLocusMainRecord } from '../spec.js'

/** The exact durable surface used by this adapter. */
export type DurableControllerRepositoryPort = Pick<
  DurableLocusRepository,
  | 'getCurrentLocus'
  | 'getLatestLocusByEndpoint'
  | 'getDefaultQaLocus'
  | 'getLocusMain'
  | 'getActiveLocusMainForWork'
  | 'listLociByParent'
  | 'hasPendingDeliveries'
  | 'beginProvisioning'
  | 'recordProvisioningResource'
  | 'commitProvisioning'
  | 'commitRegeneration'
  | 'completeProvisioning'
  | 'failProvisioning'
  | 'getSwitchNotice'
  | 'acknowledgeSwitchNotice'
>

export type ControllerPersistenceAdapterErrorCode = 'CONTROLLER_RECORD_UNREPRESENTABLE'

/** Stable fail-closed error for an incompatible projection or unsafe write. */
export class ControllerPersistenceAdapterError extends Error {
  readonly code: ControllerPersistenceAdapterErrorCode
  readonly operation?: string

  constructor(
    code: ControllerPersistenceAdapterErrorCode,
    message: string,
    operation?: string,
  ) {
    super(message)
    this.name = 'ControllerPersistenceAdapterError'
    this.code = code
    if (operation !== undefined) this.operation = operation
  }
}

/**
 * Controller adapter over the additive durable locus tables.
 *
 * Its constructor receives only the durable locus repository, not the Pet
 * Domain, so it cannot inspect retired `chat_bindings`/`invocation_channel`.
 * Writes are limited to that repository's transaction-required provisioning
 * primitives.
 */
export class ControllerLocusRepositoryAdapter implements ControllerLocusRepository {
  constructor(private readonly durable: DurableControllerRepositoryPort) {}

  async findGroup(chatId: string): Promise<ControllerLocusGroupRecord | undefined> {
    const record = this.findLatestMarker({ chatId })
    return record === undefined ? undefined : projectGroupRecord(record, this.pairingOf(record))
  }

  /**
   * The controller port calls this `findActive`, but it is a current-generation
   * lookup: unavailable markers must remain visible so ensure does not mistake
   * an explicit stop/invalidation/retirement for a never-created endpoint.
   */
  async findActive(endpoint: ControllerLocusEndpoint): Promise<ControllerLocusRecord | undefined> {
    const record = this.findLatestMarker(endpoint)
    return record === undefined ? undefined : projectLocusRecord(record, this.pairingOf(record))
  }

  /**
   * The default Q&A pointer hangs from a LOCUS MAIN (the session the entry's
   * row is indexed under), while callers ask by the work session they opened.
   * A work session that never had a locus main has not established a Q&A yet:
   * that is "not established", not an error — the caller creates the main next.
   */
  async findDefaultQa(workSessionId: string): Promise<ControllerLocusRecord | undefined> {
    const main = this.durable.getActiveLocusMainForWork(workSessionId)
    if (main === undefined) return undefined
    const record = this.durable.getDefaultQaLocus(main.locusMainSessionId)
    return record === undefined ? undefined : projectLocusRecord(record, this.pairingOf(record))
  }

  async findActiveMain(workSessionId: string): Promise<ControllerLocusMainRecord | undefined> {
    const main = this.durable.getActiveLocusMainForWork(workSessionId)
    return main === undefined ? undefined : projectMain(main)
  }

  async findMain(locusMainSessionId: string): Promise<ControllerLocusMainRecord | undefined> {
    const main = this.durable.getLocusMain(locusMainSessionId)
    return main === undefined ? undefined : projectMain(main)
  }

  async listEntriesOfMain(locusMainSessionId: string): Promise<readonly ControllerLocusRecord[]> {
    const main = this.durable.getLocusMain(locusMainSessionId)
    const latest = new Map<string, DurableLocusRecord>()
    for (const record of this.durable.listLociByParent(locusMainSessionId)) {
      const key = endpointKeyOf(record.endpoint)
      const previous = latest.get(key)
      if (previous === undefined || record.generation > previous.generation) latest.set(key, record)
    }
    // A retired generation is history, not an entry: the endpoint's real latest
    // row may already live under a newer locus main.
    return [...latest.values()]
      .filter(record => this.findLatestMarker(record.endpoint)?.id === record.id)
      .map(record => projectLocusRecord(record, this.pairingOf(record)))
  }

  async commitRegeneration(input: LocusRegenerationCommit): Promise<void> {
    await this.durable.commitRegeneration(projectRegenerationCommit(input))
  }

  async isLocusIdle(locusId: string): Promise<boolean> {
    return !this.durable.hasPendingDeliveries(locusId)
  }

  async commitProvisioning(input: LocusProvisioningCommit): Promise<void> {
    const durable = projectProvisioningCommit(input)
    await this.durable.commitProvisioning(durable)
  }

  async beginProvisioning(record: LocusProvisioningRecord): Promise<void> {
    await this.durable.beginProvisioning({
      provisioningId: record.provisioningId,
      kind: record.kind,
      endpoint: { ...record.endpoint },
      ...(record.parentSessionId !== undefined ? { parentSessionId: record.parentSessionId } : {}),
      startedAt: record.startedAt,
    })
  }

  async recordProvisioningResource(
    provisioningId: string,
    resource: { readonly mainSessionId?: string; readonly childSessionId?: string; readonly chatId?: string },
  ): Promise<void> {
    await this.durable.recordProvisioningResource(provisioningId, { ...resource })
  }

  async completeProvisioning(provisioningId: string): Promise<void> {
    await this.durable.completeProvisioning(provisioningId)
  }

  async failProvisioning(provisioningId: string, reason: string): Promise<void> {
    await this.durable.failProvisioning(provisioningId, reason)
  }

  async findSwitchNotice(
    locusId: string,
    generation: number,
  ): Promise<{ readonly endpoint: ControllerLocusEndpoint; readonly text: string } | undefined> {
    const notice = this.durable.getSwitchNotice(locusId, generation)
    return notice === undefined
      ? undefined
      : {
          endpoint: {
            chatId: notice.endpoint.chatId,
            ...(notice.endpoint.threadId === undefined ? {} : { threadId: notice.endpoint.threadId }),
          },
          text: notice.text,
        }
  }

  async acknowledgeSwitchNotice(locusId: string, generation: number): Promise<void> {
    await this.durable.acknowledgeSwitchNotice(locusId, generation)
  }

  /**
   * The pairing of a row that was already read. Persistence only holds paired
   * rows, so a missing one is invalid data and fails closed.
   */
  private pairingOf(record: DurableLocusRecord): PetLocusMainRecord {
    const main = this.durable.getLocusMain(record.parentSessionId)
    if (main === undefined) {
      throw unrepresentable(record, `its parent session ${record.parentSessionId} has no locus_mains pairing`)
    }
    return main
  }

  private findLatestMarker(
    endpoint: ControllerLocusEndpoint,
  ): DurableLocusRecord | undefined {
    // `loci` is the durable source of truth. The explicit latest-generation
    // primitive includes retired markers; the materialized current index does
    // not. Require the index to agree for every state it does represent.
    const endpointKey = endpointKeyOf(endpoint)
    const latest = this.durable.getLatestLocusByEndpoint(endpoint)
    const indexed = this.durable.getCurrentLocus(endpoint)
    if (latest === undefined) {
      if (indexed !== undefined) {
        throw new ControllerPersistenceAdapterError(
          'CONTROLLER_RECORD_UNREPRESENTABLE',
          `Endpoint ${endpointKey} has a current index but no durable locus record.`,
        )
      }
      return undefined
    }
    if (latest.state !== 'retired' && indexed?.id !== latest.id) {
      throw new ControllerPersistenceAdapterError(
        'CONTROLLER_RECORD_UNREPRESENTABLE',
        `Endpoint ${endpointKey} current index does not identify its latest durable generation.`,
      )
    }
    return latest
  }

}

/** Project one controller publish request into the durable aggregate shape. */
export function projectProvisioningCommit(
  input: LocusProvisioningCommit,
): DurableProvisioningCommit {
  if (input.locus.permission !== 'read') {
    throw new ControllerPersistenceAdapterError(
      'CONTROLLER_RECORD_UNREPRESENTABLE',
      'Controller provisioning cannot publish write without durable Host verification facts.',
      'commitProvisioning',
    )
  }
  const locus = buildLocusRecord({
    id: input.locus.locusId,
    generation: input.locus.generation,
    endpoint: { ...input.locus.endpoint },
    parentSessionId: input.locus.parentSessionId,
    ...(input.locus.childSessionId === undefined ? {} : { childSessionId: input.locus.childSessionId }),
    ...(input.locus.reservedChildSessionId === undefined ? {} : { reservedChildSessionId: input.locus.reservedChildSessionId }),
    ...(input.locus.childComposition === undefined ? {} : { childComposition: input.locus.childComposition }),
    ...(input.locus.toolTier !== undefined ? { toolTier: input.locus.toolTier } : {}),
    workspaceId: input.locus.workspaceId,
    ...(input.locus.parentLocusId !== undefined
      ? { parentLocusId: input.locus.parentLocusId }
      : {}),
    source: input.locus.source,
    state: input.locus.state,
    permission: { desired: 'read', effective: 'read' },
    busy: false,
    createdAt: input.locus.createdAt,
    updatedAt: input.locus.createdAt,
    ...(input.locus.replacesLocusId !== undefined
      ? { replacesLocusId: input.locus.replacesLocusId }
      : {}),
  })
  return {
    provisioningId: input.provisioningId,
    locus,
    ...(input.main !== undefined ? { main: projectMainToDurable(input.main) } : {}),
    ...(input.group !== undefined
      ? {
          group: {
            chatId: input.group.chatId,
            workspaceId: input.group.workspaceId,
            mainSessionId: input.group.mainSessionId,
            mainSource: input.group.mainSource,
            state: input.group.state,
            createdAt: input.group.createdAt,
            updatedAt: input.group.updatedAt,
          },
        }
      : {}),
    ...(input.defaultQaForParentSessionId !== undefined
      ? { defaultQaForParentSessionId: input.defaultQaForParentSessionId }
      : {}),
    ...(input.replace !== undefined
      ? {
          replace: {
            oldLocusId: input.replace.oldLocusId,
            noticeText: input.replace.noticeText,
            ...(input.replace.archivedWork ? { archivedWork: true } : {}),
          },
        }
      : {}),
    ...(input.rebuild !== undefined
      ? {
          rebuild: {
            oldLocusId: input.rebuild.oldLocusId,
            // Carried, not dropped. This projection is the ONLY path from a
            // controller commit to the durable guard, so a field it forgets is
            // a field the guard can never see — which is how the session-level
            // replacement reached production, created its new main session, and
            // was then refused by the very rule this disposition exists to
            // satisfy.
            ...(input.rebuild.predecessorDisposition === undefined
              ? {}
              : { predecessorDisposition: input.rebuild.predecessorDisposition }),
          },
        }
      : {}),
  }
}

/** Explicitly project the durable aggregate into the controller's record. */
export function projectLocusRecord(
  record: DurableLocusRecord,
  main: PetLocusMainRecord,
): ControllerLocusRecord {
  if (record.childSessionId === undefined && record.state === 'active') {
    throw unrepresentable(record, 'an active controller record requires a childSessionId')
  }
  const state = projectLocusState(record.state)
  return {
    locusId: record.id,
    generation: record.generation,
    endpoint: { ...record.endpoint },
    workspaceId: record.workspaceId,
    parentSessionId: record.parentSessionId,
    workSessionId: main.workSessionId,
    ...(record.childSessionId === undefined ? {} : { childSessionId: record.childSessionId }),
    ...(record.reservedChildSessionId === undefined ? {} : { reservedChildSessionId: record.reservedChildSessionId }),
    ...(record.childComposition === undefined ? {} : { childComposition: record.childComposition }),
    ...(record.toolTier !== undefined ? { toolTier: record.toolTier } : {}),
    ...(record.parentLocusId !== undefined ? { parentLocusId: record.parentLocusId } : {}),
    source: projectSource(record.source),
    state,
    permission: record.permission.effective,
    createdAt: record.createdAt,
    ...(state === 'retired'
      ? { retiredAt: record.retiredAt ?? record.stoppedAt ?? record.updatedAt }
      : {}),
    ...(record.replacesLocusId !== undefined ? { replacesLocusId: record.replacesLocusId } : {}),
  }
}

/** Project the chat-level locus itself as the controller's group structure. */
export function projectGroupRecord(
  record: DurableLocusRecord,
  main: PetLocusMainRecord,
): ControllerLocusGroupRecord {
  if (record.endpoint.threadId !== undefined) {
    throw unrepresentable(record, 'a topic locus cannot be projected as a group')
  }
  return {
    chatId: record.endpoint.chatId,
    workspaceId: record.workspaceId,
    // The group's "main" is the WORK session behind the row's locus main.
    mainSessionId: main.workSessionId,
    mainSource: projectMainSource(record),
    state: projectGroupState(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function projectSource(source: DurableLocusRecord['source']): ControllerLocusSource {
  return source
}

function projectMainSource(record: DurableLocusRecord): LocusMainSource {
  switch (record.source) {
    case 'auto':
    case 'explicit':
    case 'qa-created':
      return record.source
    case 'inherited':
      throw unrepresentable(record, 'a chat-level group cannot have inherited main source')
  }
}

function projectLocusState(state: DurableLocusState): ControllerLocusState {
  return state
}

function projectGroupState(record: DurableLocusRecord): ControllerLocusGroupRecord['state'] {
  return record.state
}

function unrepresentable(record: DurableLocusRecord, reason: string): ControllerPersistenceAdapterError {
  return new ControllerPersistenceAdapterError(
    'CONTROLLER_RECORD_UNREPRESENTABLE',
    `Durable locus ${record.id} cannot be projected to the controller repository: ${reason}.`,
  )
}

function projectMain(main: PetLocusMainRecord): ControllerLocusMainRecord {
  return {
    locusMainSessionId: main.locusMainSessionId,
    workSessionId: main.workSessionId,
    generation: main.generation,
    status: main.status,
    spaceId: main.spaceId,
    workspaceId: main.workspaceId,
    createdAt: main.createdAt,
    updatedAt: main.updatedAt,
    ...(main.retiredAt === undefined ? {} : { retiredAt: main.retiredAt }),
    ...(main.retiredReason === undefined ? {} : { retiredReason: main.retiredReason }),
  }
}

function projectMainToDurable(main: ControllerLocusMainRecord): PetLocusMainRecord {
  return { ...projectMain(main as unknown as PetLocusMainRecord) }
}

/** Project a controller regeneration into the durable aggregate shape. */
export function projectRegenerationCommit(input: LocusRegenerationCommit): DurableRegenerationCommit {
  return {
    provisioningId: input.provisioningId,
    entries: input.entries.map(entry => ({
      oldLocusId: entry.oldLocusId,
      reason: entry.reason,
      locus: projectProvisioningCommit({ provisioningId: input.provisioningId, locus: entry.locus }).locus,
    })),
    ...(input.main === undefined ? {} : { main: projectMainToDurable(input.main) }),
    ...(input.retireMain === undefined ? {} : { retireMain: { ...input.retireMain } }),
  }
}
