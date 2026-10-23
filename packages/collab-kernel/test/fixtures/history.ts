import { CollabService, principals, type CollabEvent, type CommitRecord, type Item, type Member, type Principal } from '../../src/index.js'
import { MemStore } from '../support/mem-store.js'
import { FakeProvider } from '../support/fake-provider.js'

/**
 * One shared commit history used by kernel `reduce-01` and dsh-collab
 * `status-pending-06`.
 *
 * Seqs 1–9 are a pre-change log written straight into the store (never through
 * the new service): a human member `pm`, item-1 settled by a human decision
 * with its confirm delivery and breaker reset, item-2 escalated, then pm leaves.
 * The new kernel then appends: invite and join of b, statusText, an item
 * revision and ack, a message that refs an item, explicit leader transfers and
 * a leave that auto-transfers leadership to b.
 */
export async function buildHistory(options: { channel?: string; prefix?: string; serviceId?: string; spaceId?: string } = {}) {
  const channel = options.channel ?? 'test-a', prefix = options.prefix ?? 'a:', spaceId = options.spaceId ?? 's'
  const store = new MemStore(), provider = new FakeProvider('P1', channel, prefix)
  const address = (name: string) => `${prefix}${name}`
  const legacyMember = (name: string, kind: Member['kind'], joinSeq: number): Member => ({ name, kind, status: 'active', joinSeq, binding: { channel, address: address(name), supports: { wake: kind === 'agent', confirm: kind === 'human' } }, statusText: '', wakeCount: 0 })
  const legacyItem = (id: string, title: string, patch: Record<string, unknown> = {}) => ({ id, kind: 'other', author: 'a', title, body: '', revision: 1, status: 'draft', requiredAcks: [], acks: {}, deciders: [], agentEditCount: 0, ...patch }) as unknown as Item
  const command = (seq: number, actor: string, events: CollabEvent[], scope: CommitRecord['receipt'] = undefined): CommitRecord => ({ kind: 'command', seq, events, receipt: scope ?? { cmdId: `legacy-${seq}`, scope: { kind: 'member', name: actor }, payloadHash: `legacy-${seq}`, result: { seq, spaceId } } })
  const a = legacyMember('a', 'agent', 1), pm = legacyMember('pm', 'human', 3)
  const legacy: CommitRecord[] = [
    command(1, 'a', [{ type: 'space/created', actor: 'a', spaceId, serviceId: 'legacy-service', leader: 'a', convention: { version: '1', sha256: 'legacy' } }, { type: 'member/joined', actor: 'a', member: a }], { cmdId: 'legacy-1', scope: { kind: 'create', channel, address: address('a') }, payloadHash: 'legacy-1', result: { seq: 1, spaceId } }),
    command(2, 'a', [{ type: 'member/invited', actor: 'a', member: { ...pm, status: 'invited', joinSeq: 0 } }]),
    command(3, 'pm', [{ type: 'member/joined', actor: 'pm', member: pm }]),
    command(4, 'a', [{ type: 'item/created', actor: 'a', item: legacyItem('item-1', 'first', { kind: 'charter', deciders: ['pm'] }) }]),
    command(5, 'a', [
      { type: 'decision/requested', actor: 'a', request: { id: 'decision-5', itemId: 'item-1', revision: 1, author: 'a', options: ['yes', 'no'], deciders: ['pm'], status: 'open', awaitingChannel: false } },
      { type: 'dispatch/intended', actor: 'a', delivery: { deliveryId: 'delivery-5-1', member: 'pm', kind: 'confirm', providerId: 'P1', requestId: 'decision-5' } },
    ]),
    { kind: 'completion', seq: 6, events: [{ type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: 'delivery-5-1', outcome: 'succeeded', messageRef: 'm-1' }] },
    command(7, 'pm', [
      { type: 'decision/decided', actor: 'pm', decision: { requestId: 'decision-5', itemId: 'item-1', actor: 'pm', choice: 'yes', providerId: 'P1', actionId: 'click-1', deliveryId: 'delivery-5-1', messageRef: 'm-1' } },
      { type: 'breaker/reset', actor: 'pm', member: 'a' },
    ]),
    command(8, 'a', [
      { type: 'item/created', actor: 'a', item: legacyItem('item-2', 'second') },
      { type: 'item/revised', actor: 'a', item: legacyItem('item-2', 'second', { revision: 5, status: 'escalated', agentEditCount: 4 }) },
    ]),
    command(9, 'pm', [{ type: 'member/status', actor: 'pm', name: 'pm', status: 'gone' }]),
  ]
  store.records.set(spaceId, legacy)
  const service = new CollabService({ serviceId: options.serviceId ?? 'service-1', store, providers: [provider] })
  await service.open(spaceId)
  const agent = (name: string): Principal => principals.agent({ channel, address: address(name) })
  let n = 0
  const ctx = (principal: Principal) => ({ spaceId, principal, cmdId: `h-${++n}` })
  const settle = async () => {
    for (let turn = 0; turn < 50; turn++) {
      const o = await service.overview({ spaceId, principal: principals.internal('host-index') })
      if (!o.inFlightDeliveries.length) return
      await new Promise(resolve => setImmediate(resolve))
    }
    throw new Error('deliveries did not settle')
  }
  await service.invite(ctx(agent('a')), { name: 'b', address: address('b'), kind: 'agent' })
  await service.join(ctx(agent('b')))
  await service.setStatus(ctx(agent('b')), { text: 'working\non it' })
  const item3 = await service.createItem(ctx(agent('a')), { itemId: 'item-3', kind: 'charter', title: 'third', body: '', requiredAcks: ['b'] })
  await service.reviseItem(ctx(agent('a')), { itemId: 'item-3', expectedRevision: 1, changes: { body: 'v2' } })
  await service.ackItem(ctx(agent('b')), { itemId: 'item-3', revision: 2 })
  await service.sendMessage(ctx(agent('a')), { to: 'b', body: 'about item-3', needsReply: true, ref: item3.seq })
  await service.transferLeader(ctx(agent('a')), { member: 'b' })
  await service.transferLeader(ctx(agent('b')), { member: 'a' })
  await service.leave(ctx(agent('a')))
  await settle()
  const records: CommitRecord[] = structuredClone(store.records.get(spaceId)!)
  return { service, store, provider, records, spaceId }
}
