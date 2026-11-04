/**
 * Pet's side of the Locus collaboration space
 * (`locus-three-tier-structure` design D8; spec `pet-locus-intent-triage`
 * "协作空间由干活主会话与 locus 主会话两个普通成员组成").
 *
 * Owns: the dsh-collab integrator adapter (only `owns` is meaningful), the
 * attach lifecycle, and space establishment. A space has exactly two ordinary
 * members — the locus main session (Leader) and the work main session — and
 * is created by acting AS the locus main session through `actAs`.
 *
 * Never: opens a model turn, sends anything to Feishu, or wakes a session
 * other than the single wake `invite` causes for the work main session.
 */
import {
  LOCUS_MEMBER, PET_COLLAB_CHANNEL, WORK_MEMBER,
  establishCmdId, locusSpaceId, locusSpacePurpose,
} from './naming.js'
import { foldSpace, type FoldedSpace } from './space-fold.js'
import {
  isHandleError,
  type CollabActAsOp, type CollabCommitRecord, type CollabIntegratorAdapter, type CollabIntegrationHandle, type CollabService,
} from './types.js'

/** One durable locus main ↔ work main pair (a row of `locus_mains`). */
export interface LocusMainRef {
  readonly locusMainSessionId: string
  readonly workSessionId: string
}

/** Every locus main session Pet ever created, history (replaced/archived) included. */
export interface LocusMainDirectory {
  list(): readonly LocusMainRef[]
}

export interface LocusCollabDeps {
  readonly directory: LocusMainDirectory
  /** Work main session title for the space purpose; optional. */
  workTitle?(workSessionId: string): string | undefined
  log?(message: string): void
}

export type EnsureSpaceOutcome =
  | { readonly ok: true; readonly spaceId: string }
  | {
    readonly ok: false
    readonly reason: 'collab-unavailable' | 'work-not-invitable' | 'establish-failed'
    readonly code?: string
  }

export type ActAsOutcome<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string }

/** Whether a folded space meets the "established" definition for this pair. */
function establishedIn(space: FoldedSpace, ref: LocusMainRef): boolean {
  const locus = space.members.get(LOCUS_MEMBER)
  const work = space.members.get(WORK_MEMBER)
  return space.leader === LOCUS_MEMBER
    && locus !== undefined && locus.status === 'active' && locus.address === ref.locusMainSessionId
    && space.managers.has(PET_COLLAB_CHANNEL)
    && work !== undefined && work.status === 'active' && work.address === ref.workSessionId
}

export class LocusCollab {
  private handle: CollabIntegrationHandle | undefined
  private readonly established = new Set<string>()
  private readonly inFlight = new Map<string, Promise<EnsureSpaceOutcome>>()
  /**
   * Locus mains whose space Pet is establishing right now. Their pairing row is
   * committed only after the space exists, so the durable directory cannot
   * vouch for them yet; Pet just created them, and stops vouching once done.
   */
  private readonly establishing = new Set<string>()

  constructor(private readonly deps: LocusCollabDeps) {}

  /**
   * The adapter Pet registers with dsh-collab. Pet has no managed member:
   * nothing is claimed or held and no caller resolves, so only `owns` matters.
   */
  readonly adapter: CollabIntegratorAdapter = Object.freeze({
    claim: () => false,
    presence: () => 'unreachable' as const,
    deliver: () => { throw new Error('Pet has no managed collaboration member') },
    resolveCaller: () => undefined,
    holds: () => false,
    owns: (sessionId: string) => {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      return this.establishing.has(sessionId)
        || this.deps.directory.list().some(ref => ref.locusMainSessionId === sessionId)
    },
  })

  /** The current handle, or undefined while dsh-collab is not attached. */
  currentHandle(): CollabIntegrationHandle | undefined {
    return this.handle
  }

  /** Attach to dsh-collab; returns a disposer. */
  attach(service: CollabService): () => void {
    const handle = service.attach(PET_COLLAB_CHANNEL, this.adapter)
    this.handle = handle
    return () => {
      if (this.handle === handle) this.handle = undefined
      this.established.clear()
      try { handle.dispose() } catch { /* already detached */ }
    }
  }

  isEstablished(locusMainSessionId: string): boolean {
    return this.established.has(locusMainSessionId)
  }

  /** The durable pair for a locus main session, if Pet created it. */
  refOf(locusMainSessionId: string): LocusMainRef | undefined {
    return this.deps.directory.list().find(ref => ref.locusMainSessionId === locusMainSessionId)
  }

  /**
   * Whether a locus main session's space is usable: already established, or
   * provably established on disk (a restart loses the in-memory flag). Never
   * creates or invites anything.
   */
  async isReady(locusMainSessionId: string): Promise<boolean> {
    if (this.established.has(locusMainSessionId)) return true
    const ref = this.refOf(locusMainSessionId)
    return ref !== undefined && await this.probe(ref)
  }

  /** Run one closed command as a locus main session Pet owns. */
  async actAs<T = any>(locusMainSessionId: string, cmdId: string, op: CollabActAsOp): Promise<ActAsOutcome<T>> {
    const handle = this.handle
    if (handle === undefined) return { ok: false, code: 'COLLAB_UNAVAILABLE' }
    const result = await handle.actAs(locusMainSessionId, locusSpaceId(locusMainSessionId), cmdId, op)
    if (isHandleError(result)) return { ok: false, code: this.noticeDetached(handle, result.error.code) }
    return { ok: true, value: result as T }
  }

  /** Full manager read of one locus main session's space; undefined when unreadable. */
  async readSpace(locusMainSessionId: string): Promise<readonly CollabCommitRecord[] | undefined> {
    const handle = this.handle
    if (handle === undefined) return undefined
    const records = await handle.readManaged(locusSpaceId(locusMainSessionId))
    if (isHandleError(records)) {
      this.noticeDetached(handle, records.error.code)
      return undefined
    }
    return records
  }

  /** A detached handle (dsh-collab went away) is dropped, so callers see "collaboration unavailable". */
  private noticeDetached(handle: CollabIntegrationHandle, code: string): string {
    if (code !== 'COLLAB_CHANNEL_DETACHED') return code
    if (this.handle === handle) this.handle = undefined
    this.established.clear()
    return 'COLLAB_UNAVAILABLE'
  }

  /** Mark an already-established space (startup/attach); never creates or invites anything. */
  async probe(ref: LocusMainRef): Promise<boolean> {
    const records = await this.readSpace(ref.locusMainSessionId)
    if (records === undefined || !establishedIn(foldSpace(records), ref)) return false
    this.established.add(ref.locusMainSessionId)
    return true
  }

  /**
   * Make sure the space for one locus main session is established: create it
   * as the locus main session (Leader), grant Pet's channel as manager, and
   * invite the work main session. Idempotent per pair.
   */
  ensureSpace(ref: LocusMainRef): Promise<EnsureSpaceOutcome> {
    const running = this.inFlight.get(ref.locusMainSessionId)
    if (running !== undefined) return running
    this.establishing.add(ref.locusMainSessionId)
    const attempt = this.establish(ref).finally(() => {
      this.inFlight.delete(ref.locusMainSessionId)
      this.establishing.delete(ref.locusMainSessionId)
    })
    this.inFlight.set(ref.locusMainSessionId, attempt)
    return attempt
  }

  private async establish(ref: LocusMainRef): Promise<EnsureSpaceOutcome> {
    if (this.handle === undefined) return { ok: false, reason: 'collab-unavailable' }
    const main = ref.locusMainSessionId
    const spaceId = locusSpaceId(main)
    if (this.established.has(main)) return { ok: true, spaceId }
    if (await this.probe(ref)) return { ok: true, spaceId }

    const created = await this.actAs(main, establishCmdId(main, 'create'), {
      op: 'createSpace',
      input: { name: LOCUS_MEMBER, purpose: locusSpacePurpose(this.deps.workTitle?.(ref.workSessionId)) },
    })
    if (!created.ok && created.code !== 'COLLAB_SPACE_EXISTS') {
      return { ok: false, reason: created.code === 'COLLAB_UNAVAILABLE' ? 'collab-unavailable' : 'establish-failed', code: created.code }
    }
    const allowed = await this.actAs(main, establishCmdId(main, 'allow'), {
      op: 'allowManager', input: { channel: PET_COLLAB_CHANNEL },
    })
    // Our own declared channel is valid, so BAD_CHANNEL here can only mean "already granted".
    if (!allowed.ok && allowed.code !== 'COLLAB_BAD_CHANNEL') return { ok: false, reason: 'establish-failed', code: allowed.code }

    const invited = await this.actAs(main, establishCmdId(main, 'invite'), {
      op: 'invite', input: { name: WORK_MEMBER, address: ref.workSessionId },
    })
    if (!invited.ok && invited.code !== 'COLLAB_NAME_TAKEN') {
      return {
        ok: false,
        reason: invited.code === 'COLLAB_ADDRESS_UNCLAIMED' ? 'work-not-invitable' : 'establish-failed',
        code: invited.code,
      }
    }
    if (!(await this.probe(ref))) return { ok: false, reason: 'establish-failed' }
    this.deps.log?.(`dsh-pet collab: established ${spaceId}`)
    return { ok: true, spaceId }
  }
}
