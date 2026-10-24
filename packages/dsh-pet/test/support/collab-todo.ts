/**
 * A Locus todo world over the REAL dsh-collab plugin: Pet's proxy and the
 * collab `TodoBackend`, with locus records the test can add, switch and retire.
 *
 * `register` goes through `trackTodo` — the exact function `pet_locus_track`
 * runs — with an authorized current-Delivery record built from the locus row.
 */
import { endpointKeyOf, type LocusEndpoint } from '../../src/host/locus/aggregate.js'
import type { LocusContextRecord } from '../../src/host/locus/context-repository.js'
import { locusIdentity, locusSpaceId } from '../../src/host/collab/naming.js'
import { LocusCollabProxy, type ProxyLocusRecord } from '../../src/host/collab/proxy.js'
import { CollabTodoBackend } from '../../src/host/collab/todo-backend.js'
import { trackTodo, type TrackResult } from '../../src/host/ledger/track.js'
import { SUBAGENT_HEADER, openCollabWorld, result, type CollabWorld } from './collab-host.js'

export interface TodoWorld {
  readonly world: CollabWorld
  readonly proxy: LocusCollabProxy
  readonly backend: CollabTodoBackend
  /** Add (or replace) a locus record; its child is published live unless `live: false`. */
  addLocus(record: ProxyLocusRecord, options?: { live?: boolean }): void
  /** Replace a record in place (state change), keeping the rest. */
  updateLocus(id: string, patch: Partial<ProxyLocusRecord>): void
  /** Load a main session; establishes its space when it has an active locus. */
  loadMain(parentSessionId: string): Promise<void>
  /** Register a todo exactly as `pet_locus_track` does for this locus's current child. */
  register(recordId: string, evidence: { summary: string; detail: string }, itemId?: string): Promise<TrackResult>
  /** Full manager read of a parent's space. */
  records(parentSessionId: string): Promise<any[]>
  /** A fresh proxy + backend over the SAME dsh-collab store (a Pet restart). */
  restartPet(): Promise<TodoWorld>
  readonly loci: ProxyLocusRecord[]
}

export function identityOf(endpoint: LocusEndpoint): string {
  return locusIdentity(endpointKeyOf(endpoint))
}

export function authorizedFor(record: ProxyLocusRecord, messageId = `om-${record.id}`): LocusContextRecord {
  return {
    endpoint: record.endpoint,
    locus: { locusId: record.id, generation: record.generation, state: 'active' },
    main: { sessionId: record.parentSessionId },
    child: { sessionId: record.childSessionId! },
    workspace: { workspaceId: 'ws-todo' },
    permission: { effective: 'read' },
    contextAnchor: { status: 'unknown' },
    currentDelivery: {
      deliveryId: `delivery-${messageId}`,
      messageId,
      endpoint: record.endpoint,
      locusId: record.id,
      generation: record.generation,
      childSessionId: record.childSessionId!,
      status: 'current',
      queueState: 'current',
      senderOpenId: 'ou_requester',
    },
  } as unknown as LocusContextRecord
}

let itemSeq = 0

function compose(world: CollabWorld, loci: ProxyLocusRecord[]): Omit<TodoWorld, 'restartPet'> {
  const proxy = new LocusCollabProxy({ listLoci: () => loci, liveAgent: id => world.live.get(id) })
  proxy.attach(world.service)
  const backend = new CollabTodoBackend({
    proxy,
    childOf: ({ locusId, parentSessionId }) => loci.find(record => record.id === locusId && record.parentSessionId === parentSessionId)?.childSessionId,
    liveAgent: id => world.live.get(id),
  })
  const self: Omit<TodoWorld, 'restartPet'> = {
    world, proxy, backend, loci,
    addLocus(record, options = {}) {
      const index = loci.findIndex(existing => existing.id === record.id)
      if (index >= 0) loci.splice(index, 1, record)
      else loci.push(record)
      if (options.live !== false && record.childSessionId !== undefined) {
        world.session(record.childSessionId, SUBAGENT_HEADER(record.parentSessionId))
      }
      proxy.refresh()
    },
    updateLocus(id, patch) {
      const index = loci.findIndex(existing => existing.id === id)
      if (index < 0) throw new Error(`no locus ${id}`)
      loci.splice(index, 1, { ...loci[index]!, ...patch })
      proxy.refresh()
    },
    async loadMain(parentSessionId) {
      world.session(parentSessionId)
      const ensured = await proxy.ensureSpace(parentSessionId)
      if (!ensured.ok) throw new Error(`space not established: ${JSON.stringify(ensured)}`)
    },
    register(recordId, evidence, itemId) {
      const record = loci.find(existing => existing.id === recordId)
      if (record === undefined) throw new Error(`no locus ${recordId}`)
      return trackTodo(authorizedFor(record), evidence, {
        store: backend,
        now: () => Date.now(),
        newItemId: () => itemId ?? `todo-${++itemSeq}`,
      })
    },
    async records(parentSessionId) {
      const value = await proxy.currentHandle()!.readManaged(locusSpaceId(parentSessionId))
      return value as any[]
    },
  }
  return self
}

export async function openTodoWorld(): Promise<TodoWorld> {
  const world = await openCollabWorld()
  const loci: ProxyLocusRecord[] = []
  const build = (): TodoWorld => {
    const self = compose(world, loci)
    return {
      ...self,
      async restartPet() {
        // The old proxy detaches; a fresh Pet attaches and rebuilds from durable facts only.
        const handle = self.proxy.currentHandle()
        handle?.dispose()
        const next = compose(world, loci)
        for (const parent of new Set(loci.map(record => record.parentSessionId))) await next.proxy.probe(parent)
        return { ...next, restartPet: () => { throw new Error('restart once') } }
      },
    }
  }
  return build()
}

export async function readOverview(world: CollabWorld, agent: unknown, parentSessionId: string) {
  return result(await world.call(agent, 'collab_read', { view: 'overview', spaceId: locusSpaceId(parentSessionId) }))
}

/** Every event type committed after `afterSeq`. */
export function eventsAfter(records: any[], afterSeq: number): string[] {
  return records.filter(record => record.seq > afterSeq).flatMap(record => record.events.map((event: any) => event.type))
}
