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
  LocusMainSource,
  LocusProvisioningCommit,
  LocusProvisioningRecord,
  LocusRecord as ControllerLocusRecord,
  LocusRepository as ControllerLocusRepository,
  LocusSource as ControllerLocusSource,
  LocusState as ControllerLocusState,
} from './controller.js'
import type {
  DurableProvisioningCommit,
  LocusRepository as DurableLocusRepository,
} from './persistence.js'

/** The exact durable surface used by this adapter. */
export type DurableControllerRepositoryPort = Pick<
  DurableLocusRepository,
  | 'getCurrentLocus'
  | 'getLatestLocusByEndpoint'
  | 'getDefaultQaLocus'
  | 'hasPendingDeliveries'
  | 'beginProvisioning'
  | 'recordProvisioningResource'
  | 'commitProvisioning'
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
    return record === undefined ? undefined : projectGroupRecord(record)
  }

  /**
   * The controller port calls this `findActive`, but it is a current-generation
   * lookup: unavailable markers must remain visible so ensure does not mistake
   * an explicit stop/invalidation/retirement for a never-created endpoint.
   */
  async findActive(endpoint: ControllerLocusEndpoint): Promise<ControllerLocusRecord | undefined> {
    const record = this.findLatestMarker(endpoint)
    return record === undefined ? undefined : projectLocusRecord(record)
  }

  async findDefaultQa(parentSessionId: string): Promise<ControllerLocusRecord | undefined> {
    const record = this.durable.getDefaultQaLocus(parentSessionId)
    return record === undefined ? undefined : projectLocusRecord(record)
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
    childSessionId: input.locus.childSessionId,
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
          },
        }
      : {}),
    ...(input.rebuild !== undefined
      ? { rebuild: { oldLocusId: input.rebuild.oldLocusId } }
      : {}),
  }
}

/** Explicitly project the durable aggregate into the controller's record. */
export function projectLocusRecord(record: DurableLocusRecord): ControllerLocusRecord {
  if (record.childSessionId === undefined) {
    throw unrepresentable(record, 'controller records require a childSessionId')
  }
  const state = projectLocusState(record.state)
  return {
    locusId: record.id,
    generation: record.generation,
    endpoint: { ...record.endpoint },
    workspaceId: record.workspaceId,
    parentSessionId: record.parentSessionId,
    childSessionId: record.childSessionId,
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
export function projectGroupRecord(record: DurableLocusRecord): ControllerLocusGroupRecord {
  if (record.endpoint.threadId !== undefined) {
    throw unrepresentable(record, 'a topic locus cannot be projected as a group')
  }
  return {
    chatId: record.endpoint.chatId,
    workspaceId: record.workspaceId,
    mainSessionId: record.parentSessionId,
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
