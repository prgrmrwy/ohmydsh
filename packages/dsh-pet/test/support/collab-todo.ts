/**
 * A Locus todo world over the REAL dsh-collab plugin: Pet's `LocusCollab` and
 * the collab `TodoBackend`, with locus main sessions and entries the test can
 * add, replace and retire.
 *
 * `register` goes through `trackTodo` — the exact function `pet_locus_track`
 * runs — with an authorized current-Delivery record built from the entry row.
 */
import { endpointKeyOf, type LocusEndpoint } from '../../src/host/locus/aggregate.js'
import type { LocusContextRecord } from '../../src/host/locus/context-repository.js'
import { locusIdentity, locusSpaceId } from '../../src/host/collab/naming.js'
import { LocusCollab, type LocusMainRef } from '../../src/host/collab/locus-collab.js'
import { CollabTodoBackend } from '../../src/host/collab/todo-backend.js'
import { trackTodo, type TrackResult } from '../../src/host/ledger/track.js'
import { SUBAGENT_HEADER, openCollabWorld, result, type CollabWorld } from './collab-host.js'

/** One entry generation under a locus main session. */
export interface TestLocusRow {
  readonly id: string
  readonly generation: number
  readonly endpoint: LocusEndpoint
  readonly locusMainSessionId: string
  readonly childSessionId: string
  readonly state: string
}

export interface TodoWorld {
  readonly world: CollabWorld
  readonly collab: LocusCollab
  readonly backend: CollabTodoBackend
  readonly mains: LocusMainRef[]
  readonly loci: TestLocusRow[]
  /** Register a locus main + work main pair: both live, space established. */
  addMain(ref: LocusMainRef): Promise<void>
  /** Add (or replace) an entry row; its child is published live unless `live: false`. */
  addLocus(row: TestLocusRow, options?: { live?: boolean }): void
  updateLocus(id: string, patch: Partial<TestLocusRow>): void
  /** Register a todo exactly as `pet_locus_track` does for this entry row's current child. */
  register(recordId: string, evidence: { summary: string; detail: string }, itemId?: string): Promise<TrackResult>
  /** Full manager read of a locus main session's space. */
  records(locusMainSessionId: string): Promise<any[]>
  /** A fresh LocusCollab + backend over the SAME dsh-collab store (a Pet restart). */
  restartPet(): Promise<TodoWorld>
}

export function identityOf(endpoint: LocusEndpoint): string {
  return locusIdentity(endpointKeyOf(endpoint))
}

export function authorizedFor(row: TestLocusRow, messageId = `om-${row.id}`): LocusContextRecord {
  return {
    endpoint: row.endpoint,
    locus: { locusId: row.id, state: 'active' },
    main: { sessionId: row.locusMainSessionId },
    child: { sessionId: row.childSessionId },
    workspace: { workspaceId: 'ws-todo' },
    accessMode: 'read-only',
    currentDelivery: {
      deliveryId: `delivery-${messageId}`,
      messageId,
      endpoint: row.endpoint,
      locusId: row.id,
      sessionId: row.childSessionId,
      status: 'current',
      queueState: 'current',
      senderOpenId: 'ou_requester',
    },
  } as unknown as LocusContextRecord
}

let itemSeq = 0

function compose(world: CollabWorld, mains: LocusMainRef[], loci: TestLocusRow[]): Omit<TodoWorld, 'restartPet'> {
  const collab = new LocusCollab({ directory: { list: () => mains } })
  collab.attach(world.service)
  const backend = new CollabTodoBackend({ collab, directory: { list: () => mains } })
  return {
    world, collab, backend, mains, loci,
    async addMain(ref) {
      if (!mains.some(existing => existing.locusMainSessionId === ref.locusMainSessionId)) mains.push(ref)
      world.session(ref.locusMainSessionId)
      if (!world.live.has(ref.workSessionId)) world.session(ref.workSessionId)
      const ensured = await collab.ensureSpace(ref)
      if (!ensured.ok) throw new Error(`space not established: ${JSON.stringify(ensured)}`)
    },
    addLocus(row, options = {}) {
      const index = loci.findIndex(existing => existing.id === row.id)
      if (index >= 0) loci.splice(index, 1, row)
      else loci.push(row)
      if (options.live !== false) world.session(row.childSessionId, SUBAGENT_HEADER(row.locusMainSessionId))
    },
    updateLocus(id, patch) {
      const index = loci.findIndex(existing => existing.id === id)
      if (index < 0) throw new Error(`no locus ${id}`)
      loci.splice(index, 1, { ...loci[index]!, ...patch })
    },
    register(recordId, evidence, itemId) {
      const row = loci.find(existing => existing.id === recordId)
      if (row === undefined) throw new Error(`no locus ${recordId}`)
      return trackTodo(authorizedFor(row), evidence, {
        store: backend,
        now: () => Date.now(),
        newItemId: () => itemId ?? `todo-${++itemSeq}`,
      })
    },
    async records(locusMainSessionId) {
      const value = await collab.readSpace(locusMainSessionId)
      return (value ?? []) as any[]
    },
  }
}

export async function openTodoWorld(): Promise<TodoWorld> {
  const world = await openCollabWorld()
  const mains: LocusMainRef[] = []
  const loci: TestLocusRow[] = []
  const self = compose(world, mains, loci)
  return {
    ...self,
    async restartPet() {
      // The old attachment detaches; a fresh Pet attaches and rebuilds from durable facts only.
      self.collab.currentHandle()?.dispose()
      const next = compose(world, mains, loci)
      for (const ref of mains) await next.collab.probe(ref)
      return { ...next, restartPet: () => { throw new Error('restart once') } }
    },
  }
}

export async function readOverview(world: CollabWorld, agent: unknown, locusMainSessionId: string) {
  return result(await world.call(agent, 'collab_read', { view: 'overview', spaceId: locusSpaceId(locusMainSessionId) }))
}

/** Every event type committed after `afterSeq`. */
export function eventsAfter(records: any[], afterSeq: number): string[] {
  return records.filter(record => record.seq > afterSeq).flatMap(record => record.events.map((event: any) => event.type))
}
