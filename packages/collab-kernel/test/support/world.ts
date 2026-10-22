import { expect } from 'vitest'
import { CollabService, principals, type CollabEvent, type CommitRecord, type Member, type MemberKind, type MemberStatus, type Principal, type Receipt } from '../../src/index.js'
import { MemStore } from './mem-store.js'
import { FakeProvider } from './fake-provider.js'
export const member = (name: string, address: string, kind: MemberKind = 'agent', status: MemberStatus = 'active', joinSeq = 1): Member => ({ name, kind, status, joinSeq, binding: { channel: 'test-a', address, supports: { wake: true, confirm: false } }, statusText: '', wakeCount: 0 })
export const defaultMembers = (): Member[] => [member('aily', 'a:1'), member('doubao', 'a:2', 'agent', 'active', 2), member('bob', 'a:9', 'agent', 'invited', 3), member('qa', 'a:qa', 'agent', 'active', 4)]
/** The seq-1 record of a seeded space: creation plus the given members and extra events. */
export function seedRecord(members: Member[] = defaultMembers(), extra: CollabEvent[] = []): CommitRecord {
  const events: CollabEvent[] = [{ type: 'space/created', actor: 'aily', spaceId: 's', serviceId: 'service-1', leader: 'aily', convention: { version: '1', sha256: 'test' } }, ...members.map(m => ({ type: m.status === 'invited' ? 'member/invited' as const : 'member/joined' as const, actor: 'aily', member: m })), ...extra]
  return { kind: 'command', seq: 1, events, receipt: { cmdId: 'seed', scope: { kind: 'create', channel: 'test-a', address: 'a:1' }, payloadHash: 'seed', result: { seq: 1, spaceId: 's' } } }
}
/** A raw command record written straight into the store; legacy fixtures never go through the service. */
export function rawCommand(seq: number, events: CollabEvent[], receipt: Partial<Receipt> = {}): CommitRecord {
  return { kind: 'command', seq, events, receipt: { cmdId: `raw-${seq}`, scope: { kind: 'member', name: 'aily' }, payloadHash: 'raw', result: { seq, spaceId: 's' }, ...receipt } }
}
/** Open a service over records seeded directly through the store. */
export async function worldFrom(records: CommitRecord[], members: Member[] = defaultMembers()) {
  const store = new MemStore(), provider = new FakeProvider()
  store.records.set('s', structuredClone(records))
  let id = 0
  const principal = (name: string): Principal => { const m = members.find(m => m.name === name); if (!m) throw new Error(name); return m.kind === 'human' ? principals.provider('P1', m.binding) : principals.agent(m.binding) }
  const w = {
    service: new CollabService({ serviceId: 'service-1', store, providers: [provider] }),
    store, provider, principal,
    ctx: (name = 'aily', cmdId = `cmd-${++id}`) => ({ spaceId: 's', principal: principal(name), cmdId }),
    read: (name = 'aily') => ({ spaceId: 's', principal: principal(name) }),
    host: () => ({ spaceId: 's', principal: principals.internal('host-index') }),
    log: () => store.records.get('s')!,
    /** Wait until no delivery is still running, so log lengths are stable. */
    settle: async () => { for (let i = 0; i < 200; i++) { if (!(await w.service.overview(w.host())).inFlightDeliveries.length) return; await new Promise(r => setImmediate(r)) } throw new Error('deliveries did not settle') },
    /** Close this instance and open the same store with a fresh one. */
    reopen: async () => { await w.settle(); await w.service.close('s'); w.service = new CollabService({ serviceId: 'service-2', store, providers: [provider] }); await w.service.open('s'); return w.service },
    /** Events of the commit with this seq. */
    events: (seq: number) => store.records.get('s')!.find(r => r.seq === seq)!.events,
  }
  await w.service.open('s')
  return w
}
export async function world(extra: CollabEvent[] = [], members = defaultMembers()) {
  return worldFrom([seedRecord(members, extra)], members)
}
export type World = Awaited<ReturnType<typeof worldFrom>>
export const intents = (events: CollabEvent[]) => events.filter((e): e is Extract<CollabEvent, { type: 'dispatch/intended' }> => e.type === 'dispatch/intended')
/**
 * Rejection oracle for a cmdId that never committed: the expected error, the
 * log unchanged, no receipt for that cmdId and no delivery started.
 */
export async function rejectsCleanly(w: World, cmdId: string, run: () => Promise<unknown>, code: string, label?: string) {
  await w.settle()
  const before = w.log().length, delivered = w.provider.deliveries.length
  await expect(run(), label).rejects.toMatchObject({ code })
  await w.settle()
  expect(w.log(), label).toHaveLength(before)
  expect(w.log().some(r => r.kind === 'command' && r.receipt.cmdId === cmdId), label).toBe(false)
  expect(w.provider.deliveries, label).toHaveLength(delivered)
}
