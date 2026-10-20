import { CollabService, principals, type CommitRecord, type Principal } from '../../src/index.js'
import { MemStore } from '../support/mem-store.js'
import { FakeProvider } from '../support/fake-provider.js'

/**
 * One shared commit history used by kernel `reduce-01` and dsh-collab
 * `status-pending-06`: create, invite, join, statusText, item revisions, ack,
 * human decision, escalation, explicit leader transfer and leave auto-transfer.
 */
export async function buildHistory(options: { channel?: string; prefix?: string; serviceId?: string; spaceId?: string } = {}) {
  const channel = options.channel ?? 'test-a', prefix = options.prefix ?? 'a:', spaceId = options.spaceId ?? 's'
  const store = new MemStore(), provider = new FakeProvider('P1', channel, prefix)
  const service = new CollabService({ serviceId: options.serviceId ?? 'service-1', store, providers: [provider] })
  const address = (name: string) => `${prefix}${name}`
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
  await service.createSpace(ctx(agent('a')), { name: 'a', address: address('a'), kind: 'agent' })
  await service.invite(ctx(agent('a')), { name: 'b', address: address('b'), kind: 'agent' })
  await service.join(ctx(agent('b')))
  await service.setStatus(ctx(agent('b')), { text: 'working\non it' })
  await service.invite(ctx(agent('a')), { name: 'pm', address: address('pm'), kind: 'human' })
  const pmBinding = { channel, address: address('pm') }
  await service.join(ctx(principals.provider('P1', pmBinding)))
  await service.createItem(ctx(agent('a')), { itemId: 'item-1', kind: 'charter', title: 'first', body: '', requiredAcks: ['b'], deciders: ['pm'] })
  await service.reviseItem(ctx(agent('a')), { itemId: 'item-1', expectedRevision: 1, changes: { body: 'v2' } })
  await service.ackItem(ctx(agent('b')), { itemId: 'item-1', revision: 2 })
  const decision = await service.requestDecision(ctx(agent('a')), { itemId: 'item-1', options: ['yes', 'no'] })
  await settle()
  const confirm = Object.values((await service.overview({ spaceId, principal: principals.internal('host-index') })).deliveries).find(d => d.kind === 'confirm' && d.requestId === decision.requestId)!
  await service.confirmDecision(ctx(principals.provider('P1', pmBinding)), { requestId: decision.requestId!, choice: 'yes', evidence: { actionId: 'click-1', deliveryId: confirm.deliveryId } })
  await service.createItem(ctx(agent('a')), { itemId: 'item-2', kind: 'other', title: 'second', body: '', requiredAcks: ['b'], deciders: [] })
  for (let revision = 1; revision <= 4; revision++) await service.reviseItem(ctx(agent('a')), { itemId: 'item-2', expectedRevision: revision, changes: { body: `r${revision}` } })
  await service.transferLeader(ctx(agent('a')), { member: 'b' })
  await service.transferLeader(ctx(agent('b')), { member: 'a' })
  await service.leave(ctx(agent('a')))
  await settle()
  const records: CommitRecord[] = structuredClone(store.records.get(spaceId)!)
  return { service, store, provider, records, spaceId }
}
