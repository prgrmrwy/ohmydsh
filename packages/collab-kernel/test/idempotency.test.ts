import { expect, it } from 'vitest'
import { CollabService, principals } from '../src/index.js'
import { world, member, rawCommand, seedRecord, worldFrom } from './support/world.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'
it('idempotency-01：原结果和序号重放不新增', async () => { const w = await world(); const ctx = w.ctx('aily', 'same'); const first = await w.service.setStatus(ctx, { text: 'x' }); expect(await w.service.setStatus(ctx, { text: 'x' })).toEqual(first); expect(w.log()).toHaveLength(2) })
it('idempotency-02：join后状态变化仍可重放', async () => { const w = await world(); const ctx = w.ctx('bob', 'join'); const first = await w.service.join(ctx); expect(await w.service.join(ctx)).toEqual(first); expect(w.log()).toHaveLength(2) })
it('idempotency-03：关闭后历史重放优先于closed', async () => { const w = await world(); const ctx = w.ctx('aily', 'status'); const first = await w.service.setStatus(ctx, { text: 'x' }); await w.service.closeSpace(w.ctx()); expect(await w.service.setStatus(ctx, { text: 'x' })).toEqual(first); expect(w.log()).toHaveLength(3) })
it('idempotency-04：同cmdId不同参数或命令冲突', async () => { const w = await world(); const ctx = w.ctx('aily', 'same'); await w.service.setStatus(ctx, { text: 'x' }); await expect(w.service.setStatus(ctx, { text: 'y' })).rejects.toMatchObject({ code: 'COLLAB_CMD_CONFLICT' }); await expect(w.service.sendMessage(ctx, { to: 'doubao', body: 'hi' })).rejects.toMatchObject({ code: 'COLLAB_CMD_CONFLICT' }); expect(w.log()).toHaveLength(2) })
it('idempotency-05：重启后幂等仍成立', async () => { const w = await world(); const ctx = w.ctx('aily', 'same'); const first = await w.service.setStatus(ctx, { text: 'x' }); await w.service.close('s'); const s = new CollabService(w.service.options); await s.open('s'); expect(await s.setStatus(ctx, { text: 'x' })).toEqual(first); expect(w.log()).toHaveLength(2) })
it('idempotency-06：失败无收据可修正重试', async () => { const w = await world(); await w.service.createItem(w.ctx(), { itemId: 'C', kind: 'other', title: 'C', body: '', requiredAcks: [] }); const ctx = w.ctx('aily', 'retry'); await expect(w.service.reviseItem(ctx, { itemId: 'C', expectedRevision: 0, changes: { body: 'x' } })).rejects.toMatchObject({ code: 'COLLAB_STALE_REVISION' }); await w.service.reviseItem(ctx, { itemId: 'C', expectedRevision: 1, changes: { body: 'x' } }); expect(w.log()).toHaveLength(3) })
it('idempotency-07：成员与旧 internal 收据互不冲突', async () => {
  const members = [member('aily', 'a:1'), member('breaker-reset', 'a:reset', 'agent', 'active', 2), member('doubao', 'a:2', 'agent', 'active', 3)]
  const legacy = rawCommand(2, [{ type: 'breaker/reset', actor: 'internal:breaker-reset', member: 'doubao' }], { cmdId: 'same-id', scope: { kind: 'internal', purpose: 'breaker-reset' }, payloadHash: 'legacy-hash' })
  const w = await worldFrom([seedRecord(members), legacy], members)
  const before = JSON.stringify(w.log()[1])
  const ctx = w.ctx('breaker-reset', 'same-id')
  const first = await w.service.setStatus(ctx, { text: 'x' })
  expect(first.seq).toBe(3)
  expect(await w.service.setStatus(ctx, { text: 'x' })).toEqual(first)
  expect(w.log()).toHaveLength(3)
  expect(JSON.stringify(w.log()[1])).toBe(before)
  expect(w.log().slice(1).map(r => r.kind === 'command' && r.receipt.scope)).toEqual([{ kind: 'internal', purpose: 'breaker-reset' }, { kind: 'member', name: 'breaker-reset' }])
})
it('idempotency-08：ref 是幂等载荷的一部分', async () => {
  const w = await world()
  const five = await w.service.sendMessage(w.ctx('doubao'), { to: 'aily', body: 'first' })
  const seven = await w.service.sendMessage(w.ctx('doubao'), { to: 'aily', body: 'second' })
  const ctx = w.ctx('aily', 'm-1')
  const original = await w.service.sendMessage(ctx, { to: 'doubao', body: 'reply', ref: five.seq })
  await w.settle()
  const receipt = JSON.stringify(w.log().find(r => r.kind === 'command' && r.receipt.cmdId === 'm-1'))
  const length = w.log().length
  await expect(w.service.sendMessage(ctx, { to: 'doubao', body: 'reply', ref: seven.seq })).rejects.toMatchObject({ code: 'COLLAB_CMD_CONFLICT' })
  expect(w.log()).toHaveLength(length)
  expect(JSON.stringify(w.log().find(r => r.kind === 'command' && r.receipt.cmdId === 'm-1'))).toBe(receipt)
  expect(await w.service.sendMessage(ctx, { to: 'doubao', body: 'reply', ref: five.seq })).toEqual(original)
  expect(w.log()).toHaveLength(length)
})
it('每种公开写命令含非空cmdId包括创建', async () => { const s = new CollabService({ serviceId: 'x', store: new MemStore(), providers: [new FakeProvider()] }); await expect(s.createSpace({ spaceId: 'new', cmdId: '', principal: principals.agent({ channel: 'test-a', address: 'a:1' }) }, { name: 'aily', address: 'a:1', kind: 'agent' })).rejects.toMatchObject({ code: 'COLLAB_BAD_CMD_ID' }) })
it('canonical参数键顺序不影响hash及并发相同cmd', async () => { const w = await world(); const ctx = w.ctx('aily', 'same'); const values = await Promise.all([w.service.sendMessage(ctx, { to: 'doubao', body: 'hi' }), w.service.sendMessage(ctx, { body: 'hi', to: 'doubao' })]); expect(values[0]).toEqual(values[1]); expect(w.log()).toHaveLength(2) })
