/**
 * Deterministic in-memory repository for unified Pet loci.
 *
 * This is intentionally independent of Pet's legacy Task/chat_bindings tables.
 * All indexes are maintained from the locus records in the same synchronous
 * transition, which makes the implementation a useful reference adapter for a
 * future durable store.
 */

import {
  buildLocusRecord,
  endpointKeyOf,
  isAutomaticSource,
  isUnavailableLocusState,
  normalizeLocusEndpoint,
  transitionLocus,
  withLocusBusy,
  withLocusPermission,
  type LocusEndpoint,
  type LocusPermission,
  type LocusPermissionMode,
  type LocusRecord,
  type LocusSource,
  type LocusState,
  type NewLocusInput,
  LocusError,
} from './aggregate.js'

export interface LocusRepositoryOptions {
  /** Inject a clock for deterministic timestamps. Defaults to a zero clock. */
  readonly now?: () => number
  /** Inject deterministic ids when adapting this repository to another store. */
  readonly idFactory?: (input: {
    readonly endpoint: LocusEndpoint
    readonly generation: number
    readonly sequence: number
  }) => string
}

export interface EnsureLocusResult {
  readonly locus: LocusRecord
  readonly created: boolean
}

export interface LocusDiscovery {
  readonly endpoint: LocusEndpoint
  readonly current?: LocusRecord
  readonly history: readonly LocusRecord[]
}

export interface ParentLocusDiscovery {
  readonly parentSessionId: string
  readonly defaultQa?: LocusRecord
  readonly loci: readonly LocusRecord[]
}

export interface ExplicitReplacementOptions {
  /** Timestamp for the transition; otherwise the repository clock is used. */
  readonly now?: number
}

export interface RebuildLocusOptions {
  /** Timestamp for the transition; otherwise the repository clock is used. */
  readonly now?: number
  /** Set the rebuilt locus as the parent's default Q&A only by explicit choice. */
  readonly asDefaultQa?: boolean
}

/**
 * A small synchronous repository whose indexes model one durable source of
 * truth.  Records are immutable snapshots; callers receive frozen records and
 * cannot mutate the repository by changing a returned object.
 */
export class LocusRepository {
  private readonly records = new Map<string, LocusRecord>()
  private readonly currentByEndpoint = new Map<string, string>()
  private readonly parentToLocusIds = new Map<string, Set<string>>()
  private readonly childToLocusId = new Map<string, string>()
  private readonly defaultQaByParent = new Map<string, string>()
  private readonly workspaceByParent = new Map<string, string>()
  private readonly highestGenerationByEndpoint = new Map<string, number>()
  private readonly now: () => number
  private readonly idFactory: NonNullable<LocusRepositoryOptions['idFactory']>
  private sequence = 0

  constructor(options: LocusRepositoryOptions = {}) {
    this.now = options.now ?? (() => 0)
    this.idFactory =
      options.idFactory ??
      (({ sequence }) => `locus-${String(sequence).padStart(4, '0')}`)
  }

  /** Number of locus generations, including stopped/retired history. */
  get size(): number {
    return this.records.size
  }

  /** Get a locus generation by its immutable locus id. */
  getLocus(locusId: string): LocusRecord | undefined {
    return this.records.get(locusId)
  }

  /** Alias for callers that use `get` for repository records. */
  get(locusId: string): LocusRecord | undefined {
    return this.getLocus(locusId)
  }

  /** List all generations in deterministic generation/id order. */
  listLoci(): readonly LocusRecord[] {
    return this.sortRecords([...this.records.values()])
  }

  /** Alias for callers that use `list` for repository records. */
  list(): readonly LocusRecord[] {
    return this.listLoci()
  }

  /** Normalize and find the endpoint's current generation. */
  getCurrent(endpoint: LocusEndpoint): LocusRecord | undefined {
    const key = normalizeLocusEndpoint(endpoint).key
    const locusId = this.currentByEndpoint.get(key)
    if (locusId === undefined) return undefined
    const record = this.records.get(locusId)
    if (record === undefined) {
      // A missing index target is corruption, not a cache miss.  Throwing here
      // prevents a caller from silently creating a second service generation.
      throw new LocusError('INVALID_LOCUS', `Endpoint index points to missing locus '${locusId}'`)
    }
    return record
  }

  /** Alias emphasizing the endpoint-index lookup. */
  findCurrentByEndpoint(endpoint: LocusEndpoint): LocusRecord | undefined {
    return this.getCurrent(endpoint)
  }

  /** Alias used by channel-facing callers. */
  getCurrentByEndpoint(endpoint: LocusEndpoint): LocusRecord | undefined {
    return this.getCurrent(endpoint)
  }

  /** Every generation ever associated with an endpoint. */
  listByEndpoint(endpoint: LocusEndpoint): readonly LocusRecord[] {
    const key = normalizeLocusEndpoint(endpoint).key
    return this.sortRecords(
      [...this.records.values()].filter(record => endpointKeyOf(record.endpoint) === key),
    )
  }

  /** Alias for explicit discovery language. */
  listLociByEndpoint(endpoint: LocusEndpoint): readonly LocusRecord[] {
    return this.listByEndpoint(endpoint)
  }

  /** Return current plus immutable endpoint history for management views. */
  discoverByEndpoint(endpoint: LocusEndpoint): LocusDiscovery {
    const normalized = normalizeLocusEndpoint(endpoint)
    const history = this.listByEndpoint(normalized.endpoint)
    const current = this.getCurrent(normalized.endpoint)
    return current === undefined
      ? { endpoint: normalized.endpoint, history }
      : { endpoint: normalized.endpoint, current, history }
  }

  /**
   * List every locus generation belonging to one parent session.  Historical
   * generations remain visible so a parent view can explain source changes.
   */
  listByParent(parentSessionId: string): readonly LocusRecord[] {
    const parent = this.requireId(parentSessionId, 'parentSessionId')
    const ids = this.parentToLocusIds.get(parent)
    if (ids === undefined) return []
    const records = [...ids].map(id => this.records.get(id)).filter(this.isRecord)
    return this.sortRecords(records)
  }

  /** Alias with an explicit locus noun. */
  listLociByParent(parentSessionId: string): readonly LocusRecord[] {
    return this.listByParent(parentSessionId)
  }

  /**
   * Find all current (non-retired) loci for a parent.  Stopped and invalid
   * rows are retained because they explain why an endpoint does not auto-heal.
   */
  listCurrentByParent(parentSessionId: string): readonly LocusRecord[] {
    return this.listByParent(parentSessionId).filter(record => record.state !== 'retired')
  }

  /** Child-session reverse lookup, including historical generations. */
  getByChild(childSessionId: string): LocusRecord | undefined {
    const child = this.requireId(childSessionId, 'childSessionId')
    const locusId = this.childToLocusId.get(child)
    if (locusId === undefined) return undefined
    const record = this.records.get(locusId)
    if (record === undefined) {
      throw new LocusError('INVALID_LOCUS', `Child index points to missing locus '${locusId}'`)
    }
    return record
  }

  /** All generations for a child identity; callers must reject ambiguity. */
  listByChild(childSessionId: string): readonly LocusRecord[] {
    const child = this.requireId(childSessionId, 'childSessionId')
    return this.sortRecords([...this.records.values()].filter(record => record.childSessionId === child))
  }

  /** Alias for caller-bound context lookups. */
  findByChildSession(childSessionId: string): LocusRecord | undefined {
    return this.getByChild(childSessionId)
  }

  /** Optional context-anchor seam; absent until a Host confirms one. */
  findContextAnchor(_input: {
    readonly childSessionId: string
    readonly locusId: string
    readonly generation: number
  }): undefined {
    return undefined
  }

  /** Optional exact current Delivery seam; in-memory repository has no ledger. */
  findCurrentDelivery(_input: {
    readonly childSessionId: string
    readonly locusId: string
    readonly generation: number
  }): undefined {
    return undefined
  }

  /** Context-tool adapter can preserve every generation instead of guessing. */
  findAllByChildSession(childSessionId: string): readonly LocusRecord[] {
    return this.listByChild(childSessionId)
  }

  /** Alias emphasizing the reverse index. */
  getLocusByChild(childSessionId: string): LocusRecord | undefined {
    return this.getByChild(childSessionId)
  }

  /** Parent's independent default Q&A pointer, including a stopped history row. */
  getDefaultQa(parentSessionId: string): LocusRecord | undefined {
    const parent = this.requireId(parentSessionId, 'parentSessionId')
    const locusId = this.defaultQaByParent.get(parent)
    if (locusId === undefined) return undefined
    const record = this.records.get(locusId)
    if (record === undefined) {
      throw new LocusError('INVALID_LOCUS', `Default Q&A index points to missing locus '${locusId}'`)
    }
    return record
  }

  /** Alias for management and Q&A controllers. */
  findDefaultQa(parentSessionId: string): LocusRecord | undefined {
    return this.getDefaultQa(parentSessionId)
  }

  /** Parent-oriented bidirectional discovery projection. */
  discoverByParent(parentSessionId: string): ParentLocusDiscovery {
    const parent = this.requireId(parentSessionId, 'parentSessionId')
    const defaultQa = this.getDefaultQa(parent)
    const loci = this.listByParent(parent)
    return defaultQa === undefined
      ? { parentSessionId: parent, loci }
      : { parentSessionId: parent, defaultQa, loci }
  }

  /** Child-oriented discovery is intentionally only one locus, never siblings. */
  discoverByChild(childSessionId: string): LocusRecord | undefined {
    return this.getByChild(childSessionId)
  }

  /**
   * Ensure one current locus for an endpoint.  Repeating the same association
   * returns the existing immutable record; it never creates a new child.
   * Automatic/inherited → explicit changes use the replacement API instead of
   * silently changing the current association.
   */
  ensureLocus(input: NewLocusInput): LocusRecord {
    return this.ensureLocusResult(input).locus
  }

  /** Same operation with an explicit created/reused result for controllers. */
  ensureLocusResult(input: NewLocusInput): EnsureLocusResult {
    const normalized = normalizeLocusEndpoint(input.endpoint)
    const endpoint = normalized.endpoint
    const key = normalized.key
    const currentId = this.currentByEndpoint.get(key)
    if (currentId !== undefined) {
      const current = this.requireRecord(currentId)
      if (current.state === 'stopped') {
        throw new LocusError(
          'LOCUS_STOPPED',
          `Endpoint '${key}' is stopped; explicitly rebuild it before accepting work`,
        )
      }
      if (current.state === 'invalid') {
        throw new LocusError(
          'LOCUS_INVALID',
          `Endpoint '${key}' is invalid; explicitly repair or rebuild it before accepting work`,
        )
      }
      if (current.state === 'retired') {
        throw new LocusError('INVALID_LOCUS', `Endpoint '${key}' indexes a retired locus`)
      }

      const parentSessionId = this.requireId(input.parentSessionId, 'parentSessionId')
      const workspaceId = this.requireId(input.workspaceId, 'workspaceId')
      const parentLocusId = this.optionalId(input.parentLocusId)
      const identityMatches =
        current.parentSessionId === parentSessionId &&
        current.workspaceId === workspaceId &&
        (current.parentLocusId ?? undefined) === parentLocusId

      if (identityMatches && current.source === input.source) {
        if (input.childSessionId !== undefined && input.childSessionId !== current.childSessionId) {
          throw new LocusError(
            'CHILD_OCCUPIED',
            `Endpoint '${key}' is already ensured by child '${current.childSessionId ?? 'none'}'`,
          )
        }
        return { locus: current, created: false }
      }
      if (input.source === 'explicit' && isAutomaticSource(current.source)) {
        throw new LocusError(
          'REPLACEMENT_REQUIRED',
          `Endpoint '${key}' is automatic; explicit binding requires an idle replacement`,
        )
      }
      if (current.source === 'explicit') {
        throw new LocusError(
          'EXPLICIT_SOURCE_LOCKED',
          `Endpoint '${key}' already has an explicit source and cannot be overwritten`,
        )
      }
      throw new LocusError('ENDPOINT_OCCUPIED', `Endpoint '${key}' already has a different locus`)
    }

    const locus = this.buildNewRecord({ ...input, endpoint })
    this.commitNewRecord(locus)
    return { locus, created: true }
  }

  /** Short alias for controllers that call this operation simply `ensure`. */
  ensure(input: NewLocusInput): LocusRecord {
    return this.ensureLocus(input)
  }

  /**
   * Create/open the parent's default Q&A entry.  Existing default pointers are
   * returned as-is; an invalid/stopped default is surfaced instead of silently
   * switching to an issue or topic locus.
   */
  ensureDefaultQa(input: NewLocusInput): LocusRecord {
    const parent = this.requireId(input.parentSessionId, 'parentSessionId')
    const existing = this.getDefaultQa(parent)
    if (existing !== undefined) {
      if (existing.state === 'stopped') {
        throw new LocusError('LOCUS_STOPPED', `Default Q&A for '${parent}' is stopped`)
      }
      if (existing.state === 'invalid') {
        throw new LocusError('LOCUS_INVALID', `Default Q&A for '${parent}' is invalid`)
      }
      if (existing.state === 'retired') {
        throw new LocusError('LOCUS_NOT_FOUND', `Default Q&A for '${parent}' is retired`)
      }
      return existing
    }

    const locus = this.ensureLocus({ ...input, parentSessionId: parent, source: 'qa-created' })
    this.setDefaultQa(parent, locus.id)
    return locus
  }

  /** Q&A spelling alias. */
  ensureQa(input: NewLocusInput): LocusRecord {
    return this.ensureDefaultQa(input)
  }

  /**
   * Set a parent's default Q&A once.  Ordinary locus ensures never call this,
   * so issue/topic fan-out cannot move the GUI default by recency.
   */
  setDefaultQa(parentSessionId: string, locusId: string): LocusRecord {
    const parent = this.requireId(parentSessionId, 'parentSessionId')
    const locus = this.requireRecord(locusId)
    if (locus.parentSessionId !== parent) {
      throw new LocusError(
        'DEFAULT_QA_CONFLICT',
        `Locus '${locusId}' does not belong to parent '${parent}'`,
      )
    }
    if (locus.state === 'retired' || locus.state === 'invalid' || locus.state === 'stopped') {
      throw new LocusError('DEFAULT_QA_CONFLICT', 'A default Q&A must be available for service')
    }
    const existingId = this.defaultQaByParent.get(parent)
    if (existingId !== undefined && existingId !== locus.id) {
      throw new LocusError(
        'DEFAULT_QA_CONFLICT',
        `Parent '${parent}' already has default Q&A locus '${existingId}'`,
      )
    }
    this.defaultQaByParent.set(parent, locus.id)
    return locus
  }

  /** Explicitly point a rebuilt locus at the parent's default Q&A slot. */
  replaceDefaultQa(parentSessionId: string, locusId: string): LocusRecord {
    const parent = this.requireId(parentSessionId, 'parentSessionId')
    const locus = this.requireRecord(locusId)
    if (locus.parentSessionId !== parent) {
      throw new LocusError(
        'DEFAULT_QA_CONFLICT',
        `Locus '${locusId}' does not belong to parent '${parent}'`,
      )
    }
    if (locus.state === 'retired' || locus.state === 'invalid' || locus.state === 'stopped') {
      throw new LocusError('DEFAULT_QA_CONFLICT', 'A default Q&A must be available for service')
    }
    this.defaultQaByParent.set(parent, locus.id)
    return locus
  }

  /**
   * Replace an idle automatic/inherited generation with an explicit source.
   * The old record is retired, not deleted; the new child is read by default,
   * receives the next endpoint generation, and becomes the sole current row.
   */
  replaceAutomaticWithExplicit(
    endpointInput: LocusEndpoint,
    input: NewLocusInput,
    options: ExplicitReplacementOptions = {},
  ): LocusRecord {
    const normalizedEndpoint = normalizeLocusEndpoint(endpointInput)
    const endpoint = normalizedEndpoint.endpoint
    const key = normalizedEndpoint.key
    const current = this.getCurrent(endpoint)
    if (current === undefined) {
      throw new LocusError(
        'LOCUS_NOT_FOUND',
        `Endpoint '${key}' has no automatic locus to replace`,
      )
    }

    const requestedParent = this.requireId(input.parentSessionId, 'parentSessionId')
    const requestedWorkspace = this.requireId(input.workspaceId, 'workspaceId')
    const requestedParentLocus = this.optionalId(input.parentLocusId)
    const sameTarget =
      current.parentSessionId === requestedParent &&
      current.workspaceId === requestedWorkspace &&
      (current.parentLocusId ?? undefined) === requestedParentLocus

    if (input.endpoint !== undefined && endpointKeyOf(input.endpoint) !== key) {
      throw new LocusError('INVALID_ENDPOINT', 'Replacement input endpoint does not match target endpoint')
    }
    if (current.source === 'explicit') {
      if (input.source === 'explicit' && sameTarget) {
        if (input.childSessionId !== undefined && this.optionalId(input.childSessionId) !== current.childSessionId) {
          throw new LocusError('CHILD_OCCUPIED', 'An explicit retry cannot replace its child session')
        }
        return current
      }
      throw new LocusError(
        'EXPLICIT_SOURCE_LOCKED',
        `Endpoint '${key}' already has an explicit source and cannot be overwritten`,
      )
    }
    if (!isAutomaticSource(current.source)) {
      throw new LocusError(
        'REPLACEMENT_REQUIRED',
        `Endpoint '${key}' is sourced by '${current.source}', not an automatic locus`,
      )
    }
    if (input.source !== 'explicit') {
      throw new LocusError(
        'REPLACEMENT_REQUIRED',
        'Automatic locus replacement requires an explicit source',
      )
    }
    if (current.state !== 'active') {
      throw new LocusError(
        'INVALID_STATE',
        `Automatic locus '${current.id}' must be active before replacement`,
      )
    }
    if (current.busy) {
      throw new LocusError(
        'LOCUS_BUSY',
        `Automatic locus '${current.id}' has accepted work and cannot be replaced yet`,
      )
    }
    if (input.endpoint !== undefined && endpointKeyOf(input.endpoint) !== key) {
      throw new LocusError('INVALID_ENDPOINT', 'Replacement input endpoint does not match target endpoint')
    }
    if (input.childSessionId !== undefined && input.childSessionId === current.childSessionId) {
      throw new LocusError('CHILD_OCCUPIED', 'Replacement must use a new childSessionId')
    }

    const now = options.now ?? this.now()
    const nextGeneration = this.nextGeneration(key)
    const replacement = this.buildNewRecord({
      ...input,
      endpoint,
      generation: nextGeneration,
      source: 'explicit',
      permission: { desired: 'read', effective: 'read' },
      replacesLocusId: current.id,
    })

    // All validation, including child and parent/workspace ownership, happens
    // before this point.  Commit is synchronous, so no half-switched pointer is
    // observable by another repository caller. Remove the old current pointer
    // before commit: the endpoint index permits exactly one current generation.
    const retired = transitionLocus(current, 'retired', now, { busy: false })
    this.records.set(current.id, retired)
    this.currentByEndpoint.delete(key)
    try {
      this.commitNewRecord(replacement)
    } catch (error) {
      // Keep the old generation serviceable if a future storage adapter rejects
      // the new write after validation.
      this.records.set(current.id, current)
      this.currentByEndpoint.set(key, current.id)
      throw error
    }
    return replacement
  }

  /** Alias used by callers that frame this as a source switch. */
  replaceAutomatic(
    endpoint: LocusEndpoint,
    input: NewLocusInput,
    options: ExplicitReplacementOptions = {},
  ): LocusRecord {
    return this.replaceAutomaticWithExplicit(endpoint, input, options)
  }

  /**
   * Explicitly rebuild an unavailable endpoint.  This is the only operation
   * that can clear a stopped/invalid marker; ordinary ensure never revives it.
   */
  rebuildLocus(input: NewLocusInput, options: RebuildLocusOptions = {}): LocusRecord {
    const normalized = normalizeLocusEndpoint(input.endpoint)
    const endpoint = normalized.endpoint
    const key = normalized.key
    const current = this.getCurrent(endpoint)
    if (current !== undefined && !isUnavailableLocusState(current.state)) {
      throw new LocusError(
        'ENDPOINT_OCCUPIED',
        `Endpoint '${key}' still has available locus '${current.id}'`,
      )
    }
    const locus = this.buildNewRecord({
      ...input,
      endpoint,
      generation: this.nextGeneration(key),
      permission: { desired: 'read', effective: 'read' },
    })
    // An unavailable generation intentionally remains the endpoint's current
    // pointer until this explicit rebuild has passed validation.  Temporarily
    // clear that pointer only for the synchronous commit, restoring it if the
    // adapter ever rejects the commit.
    const previousCurrentId = this.currentByEndpoint.get(key)
    if (previousCurrentId !== undefined) this.currentByEndpoint.delete(key)
    try {
      this.commitNewRecord(locus)
    } catch (error) {
      if (previousCurrentId !== undefined) this.currentByEndpoint.set(key, previousCurrentId)
      throw error
    }
    if (options.asDefaultQa === true) {
      this.replaceDefaultQa(locus.parentSessionId, locus.id)
    }
    return locus
  }

  /** Return true when an accepted/queued/running Delivery fences lifecycle changes. */
  hasAcceptedWork(locusId: string): boolean {
    const current = this.requireRecord(locusId)
    return current.busy
  }

  /** Mark a locus unavailable without deleting its endpoint pointer. */
  invalidateLocus(locusId: string, reason: string, now = this.now()): LocusRecord {
    const current = this.requireRecord(locusId)
    if (current.state === 'retired' || current.state === 'stopped') return current
    if (current.busy) throw new LocusError('LOCUS_BUSY', `Locus '${locusId}' is busy`)
    const next = transitionLocus(current, 'invalid', now, {
      busy: false,
      invalidReason: this.requireId(reason, 'reason'),
    })
    this.records.set(locusId, next)
    // Keep the endpoint pointer on invalid tombstones.  An invalid marker is
    // materially different from never-created: ensure must reject revival and
    // callers need the reason for an explicit repair/rebuild decision.
    return next
  }

  /**
   * Stop a locus explicitly.  Stopped differs from retired: the endpoint index
   * keeps pointing at it so normal routing reports a stop instead of rebuilding.
   */
  stopLocus(locusId: string, now = this.now()): LocusRecord {
    const current = this.requireRecord(locusId)
    if (current.state === 'stopped' || current.state === 'retired') return current
    if (current.busy) throw new LocusError('LOCUS_BUSY', `Locus '${locusId}' is busy`)
    const next = transitionLocus(current, 'stopped', now, { busy: false })
    this.records.set(locusId, next)
    return next
  }

  /** Alias matching an explicit unbind/stop controller. */
  stop(locusId: string, now = this.now()): LocusRecord {
    return this.stopLocus(locusId, now)
  }

  /**
   * Retire a locus generation and clear the current endpoint pointer.  History,
   * parent membership, child reverse lookup, and default-Q&A pointer remain.
   */
  retireLocus(locusId: string, now = this.now()): LocusRecord {
    const current = this.requireRecord(locusId)
    if (current.state === 'retired') return current
    if (current.busy) throw new LocusError('LOCUS_BUSY', `Locus '${locusId}' is busy`)
    const next = transitionLocus(current, 'retired', now, { busy: false })
    this.records.set(locusId, next)
    const key = endpointKeyOf(current.endpoint)
    if (this.currentByEndpoint.get(key) === locusId) this.currentByEndpoint.delete(key)
    return next
  }

  /** Alias matching an archive/retire controller. */
  retire(locusId: string, now = this.now()): LocusRecord {
    return this.retireLocus(locusId, now)
  }

  /** Pause Delivery intake while an external Host permission mutation runs. */
  beginPermissionMutation(locusId: string, now = this.now()): LocusRecord {
    const current = this.requireRecord(locusId)
    if (current.state !== 'active' || current.busy) {
      throw new LocusError('LOCUS_BUSY', `Locus '${locusId}' cannot enter permission mutation`)
    }
    const next = transitionLocus(current, 'switching', now)
    this.records.set(locusId, next)
    return next
  }

  /** Restore service after the prior Host policy has been verified. */
  abortPermissionMutation(locusId: string, now = this.now()): LocusRecord {
    const current = this.requireRecord(locusId)
    if (current.state !== 'switching' || current.busy) {
      throw new LocusError('LOCUS_BUSY', `Locus '${locusId}' cannot abort permission mutation`)
    }
    const next = transitionLocus(current, 'active', now)
    this.records.set(locusId, next)
    return next
  }

  /** Commit verified permission and reopen intake as one in-memory mutation. */
  commitPermissionMutation(
    locusId: string,
    permission: LocusPermission,
    now = this.now(),
  ): LocusRecord {
    const current = this.requireRecord(locusId)
    if (current.state !== 'switching' || current.busy) {
      throw new LocusError('LOCUS_BUSY', `Locus '${locusId}' has no permission mutation`)
    }
    const permitted = withLocusPermission(current, permission, now, { allowSwitching: true })
    const next = transitionLocus(permitted, 'active', now)
    this.records.set(locusId, next)
    return next
  }

  /** Set the accepted-work fence used by replacement and permission changes. */
  setBusy(locusId: string, busy: boolean, now = this.now()): LocusRecord {
    const current = this.requireRecord(locusId)
    if (isUnavailableLocusState(current.state)) {
      throw new LocusError('INVALID_STATE', `Locus '${locusId}' is not serviceable`)
    }
    const next = withLocusBusy(current, busy, now)
    this.records.set(locusId, next)
    return next
  }

  /** Alias for delivery adapters. */
  markBusy(locusId: string, now = this.now()): LocusRecord {
    return this.setBusy(locusId, true, now)
  }

  /** Clear the accepted-work fence after delivery settlement. */
  clearBusy(locusId: string, now = this.now()): LocusRecord {
    return this.setBusy(locusId, false, now)
  }

  /**
   * Store a verified permission projection.  New/rebuilt loci always begin at
   * read; a write result must carry a Host verification timestamp.
   */
  setPermission(
    locusId: string,
    permission: LocusPermission,
    now = this.now(),
  ): LocusRecord {
    const current = this.requireRecord(locusId)
    if (current.busy) throw new LocusError('LOCUS_BUSY', `Locus '${locusId}' is busy`)
    if (current.state !== 'active') {
      throw new LocusError('INVALID_PERMISSION', `Locus '${locusId}' is not active`)
    }
    const next = withLocusPermission(current, permission, now)
    this.records.set(locusId, next)
    return next
  }

  /** Convenience for a verified read/write mode transition. */
  setPermissionMode(
    locusId: string,
    mode: LocusPermissionMode,
    grantedBy: string,
    verifiedAt: number,
    now = this.now(),
  ): LocusRecord {
    const actor = this.requireId(grantedBy, 'grantedBy')
    return this.setPermission(
      locusId,
      {
        desired: mode,
        effective: mode,
        verifiedAt,
        grantedBy: actor,
      },
      now,
    )
  }

  /** Read-only projection used by tests/storage adapters to audit index state. */
  indexSnapshot(): {
    readonly endpointToCurrent: ReadonlyMap<string, string>
    readonly parentToLoci: ReadonlyMap<string, readonly string[]>
    readonly childToLocus: ReadonlyMap<string, string>
    readonly parentToDefaultQa: ReadonlyMap<string, string>
  } {
    const parentToLoci = new Map<string, readonly string[]>()
    for (const [parent, ids] of this.parentToLocusIds) {
      parentToLoci.set(parent, Object.freeze([...ids]))
    }
    return {
      endpointToCurrent: new Map(this.currentByEndpoint),
      parentToLoci,
      childToLocus: new Map(this.childToLocusId),
      parentToDefaultQa: new Map(this.defaultQaByParent),
    }
  }

  private buildNewRecord(input: NewLocusInput): LocusRecord {
    const normalized = normalizeLocusEndpoint(input.endpoint)
    const endpoint = normalized.endpoint
    const key = normalized.key
    const parentSessionId = this.requireId(input.parentSessionId, 'parentSessionId')
    const workspaceId = this.requireId(input.workspaceId, 'workspaceId')
    const parentLocusId = this.optionalId(input.parentLocusId)
    const childSessionId = this.optionalId(input.childSessionId)

    if (input.permission?.desired === 'write' || input.permission?.effective === 'write') {
      throw new LocusError(
        'INVALID_PERMISSION',
        'New locus generations must start read; grant write after Host verification',
      )
    }
    if (input.state === 'retired') {
      throw new LocusError('INVALID_STATE', 'New locus generations cannot start retired')
    }
    if (input.state === undefined || input.state === 'active') {
      if (childSessionId === undefined) {
        throw new LocusError('INVALID_LOCUS', 'childSessionId must be a non-empty string')
      }
    }

    this.assertParentWorkspace(parentSessionId, workspaceId)
    this.assertParentLocus(endpoint, parentSessionId, workspaceId, parentLocusId)

    const generation = input.generation ?? this.nextGeneration(key)
    const id =
      input.id?.trim() ||
      this.idFactory({ endpoint, generation, sequence: this.sequence + 1 })
    this.requireId(id, 'id')
    if (this.records.has(id)) throw new LocusError('INVALID_LOCUS', `Locus id '${id}' already exists`)

    if (childSessionId !== undefined) {
      const owner = this.childToLocusId.get(childSessionId)
      if (owner !== undefined) {
        throw new LocusError(
          'CHILD_OCCUPIED',
          `Child session '${childSessionId}' already belongs to locus '${owner}'`,
        )
      }
    }

    return buildLocusRecord({
      ...input,
      id,
      endpoint,
      parentSessionId,
      workspaceId,
      ...(parentLocusId !== undefined ? { parentLocusId } : {}),
      generation,
      // Every new association starts at the fail-safe read projection.
      permission: { desired: 'read', effective: 'read' },
      ...(childSessionId !== undefined ? { childSessionId } : {}),
      createdAt: input.createdAt ?? this.now(),
      updatedAt: input.updatedAt ?? input.createdAt ?? this.now(),
    })
  }

  private commitNewRecord(locus: LocusRecord): void {
    const key = endpointKeyOf(locus.endpoint)
    if (this.currentByEndpoint.has(key)) {
      throw new LocusError('ENDPOINT_OCCUPIED', `Endpoint '${key}' already has a current locus`)
    }

    const expectedGeneration = this.nextGeneration(key)
    if (locus.generation !== expectedGeneration) {
      throw new LocusError(
        'INVALID_LOCUS',
        `Locus '${locus.id}' generation ${locus.generation} must be the next generation ${expectedGeneration}`,
      )
    }
    if (locus.replacesLocusId !== undefined) {
      const replaced = this.records.get(locus.replacesLocusId)
      if (replaced === undefined) {
        throw new LocusError(
          'INVALID_LOCUS',
          `Replacement locus '${locus.id}' references missing locus '${locus.replacesLocusId}'`,
        )
      }
      if (endpointKeyOf(replaced.endpoint) !== key || replaced.generation + 1 !== locus.generation) {
        throw new LocusError(
          'INVALID_LOCUS',
          `Replacement locus '${locus.id}' must advance the same endpoint by exactly one generation`,
        )
      }
      if (replaced.state !== 'retired') {
        throw new LocusError(
          'INVALID_LOCUS',
          `Replacement locus '${locus.id}' can only replace a retired generation`,
        )
      }
    }

    this.records.set(locus.id, locus)
    this.sequence += 1
    this.workspaceByParent.set(locus.parentSessionId, locus.workspaceId)
    const parentIds = this.parentToLocusIds.get(locus.parentSessionId) ?? new Set<string>()
    parentIds.add(locus.id)
    this.parentToLocusIds.set(locus.parentSessionId, parentIds)
    if (locus.childSessionId !== undefined) {
      this.childToLocusId.set(locus.childSessionId, locus.id)
    }
    this.highestGenerationByEndpoint.set(
      key,
      Math.max(this.highestGenerationByEndpoint.get(key) ?? 0, locus.generation),
    )
    if (locus.state !== 'retired') this.currentByEndpoint.set(key, locus.id)
  }

  private assertParentWorkspace(parentSessionId: string, workspaceId: string): void {
    const known = this.workspaceByParent.get(parentSessionId)
    if (known !== undefined && known !== workspaceId) {
      throw new LocusError(
        'PARENT_WORKSPACE_CONFLICT',
        `Parent '${parentSessionId}' belongs to workspace '${known}', not '${workspaceId}'`,
      )
    }
    // The map is updated only by commitNewRecord after all validation passes.
    // This keeps a rejected ensure from poisoning future parent/workspace checks.
  }

  private assertParentLocus(
    endpoint: LocusEndpoint,
    parentSessionId: string,
    workspaceId: string,
    parentLocusId: string | undefined,
  ): void {
    if (parentLocusId === undefined) {
      if (endpoint.threadId !== undefined) {
        throw new LocusError('INVALID_LOCUS', 'A topic locus must identify its chat-level parent locus')
      }
      return
    }
    const parent = this.requireRecord(parentLocusId)
    if (parent.parentSessionId !== parentSessionId) {
      throw new LocusError('INVALID_LOCUS', 'A topic locus parent must belong to the same parent session')
    }
    if (parent.workspaceId !== workspaceId) {
      throw new LocusError('PARENT_WORKSPACE_CONFLICT', 'A topic locus parent must belong to the same workspace')
    }
    if (parent.parentLocusId !== undefined) {
      throw new LocusError('INVALID_LOCUS', 'A topic locus cannot have a topic locus as its parent')
    }
    if (parent.endpoint.threadId !== undefined) {
      throw new LocusError('INVALID_LOCUS', 'A topic locus parent must be the chat-level locus')
    }
    if (parent.endpoint.chatId !== endpoint.chatId) {
      throw new LocusError('INVALID_LOCUS', 'A topic locus parent must belong to the same chat')
    }
    if (parent.state === 'stopped') {
      throw new LocusError('LOCUS_STOPPED', 'A stopped chat locus cannot auto-create a topic')
    }
    if (parent.state === 'invalid' || parent.state === 'retired') {
      throw new LocusError('LOCUS_INVALID', 'An unavailable chat locus cannot parent a topic')
    }
  }

  private nextGeneration(endpointKey: string): number {
    return (this.highestGenerationByEndpoint.get(endpointKey) ?? 0) + 1
  }

  private requireRecord(locusId: string): LocusRecord {
    const id = this.requireId(locusId, 'locusId')
    const record = this.records.get(id)
    if (record === undefined) throw new LocusError('LOCUS_NOT_FOUND', `Locus '${id}' does not exist`)
    return record
  }

  private requireId(value: string, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new LocusError('INVALID_LOCUS', `${field} must be a non-empty string`)
    }
    return value.trim()
  }

  private optionalId(value: string | undefined): string | undefined {
    if (value === undefined) return undefined
    return this.requireId(value, 'identifier')
  }

  private sortRecords(records: readonly LocusRecord[]): readonly LocusRecord[] {
    return [...records].sort((left, right) => {
      if (left.generation !== right.generation) return left.generation - right.generation
      if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
      return left.id.localeCompare(right.id)
    })
  }

  private isRecord(value: LocusRecord | undefined): value is LocusRecord {
    return value !== undefined
  }
}

/** Explicit name for consumers that want to document the memory adapter. */
export class InMemoryLocusRepository extends LocusRepository {}
