import { CollabService, principals, type CollabEvent, type Member, type MemberKind, type MemberStatus, type Principal } from '../../src/index.js'
import { MemStore } from './mem-store.js'
import { FakeProvider } from './fake-provider.js'
export const member = (name: string, address: string, kind: MemberKind = 'agent', status: MemberStatus = 'active', joinSeq = 1): Member => ({ name, kind, status, joinSeq, binding: { channel: 'test-a', address, supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 })
export async function world(extra: CollabEvent[] = [], members = [member('aily', 'a:1'), member('doubao', 'a:2', 'agent', 'active', 2), member('bob', 'a:9', 'agent', 'invited', 3), member('pm', 'a:pm', 'human', 'active', 4), member('qa', 'a:qa', 'human', 'active', 5)]) {
  const store = new MemStore(), provider = new FakeProvider()
  const events: CollabEvent[] = [{ type: 'space/created', actor: 'aily', spaceId: 's', serviceId: 'service-1', leader: 'aily', convention: { version: '1', sha256: 'test' } }, ...members.map(m => ({ type: m.status === 'invited' ? 'member/invited' as const : 'member/joined' as const, actor: 'aily', member: m })), ...extra]
  store.records.set('s', [{ kind: 'command', seq: 1, events, receipt: { cmdId: 'seed', scope: { kind: 'create', channel: 'test-a', address: 'a:1' }, payloadHash: 'seed', result: { seq: 1, spaceId: 's' } } }])
  const service = new CollabService({ serviceId: 'service-1', store, providers: [provider] }); await service.open('s')
  let id = 0
  const principal = (name: string): Principal => { const m = members.find(m => m.name === name); if (!m) throw new Error(name); return m.kind === 'human' ? principals.provider('P1', m.binding) : principals.agent(m.binding) }
  const ctx = (name = 'aily', cmdId = `cmd-${++id}`) => ({ spaceId: 's', principal: principal(name), cmdId })
  return { service, store, provider, ctx, principal, read: (name = 'aily') => ({ spaceId: 's', principal: principal(name) }), log: () => store.records.get('s')! }
}
