import { describe, it, expect } from 'vitest'
import { hostContext, settle, start, tempRoot, bytes, type Host } from './support/world.js'
import { captureHost, events, gate, ledger, scriptedAdapter, service, SUBAGENT } from './support/integrator.js'

const world = (run: (host: Host) => Promise<void>) => tempRoot('collab-actas-', async root => { const host = hostContext(root); try { await run(host) } finally { await host.stop() } })
const UNAVAILABLE = { error: { code: 'COLLAB_CALLER_UNAVAILABLE' } }
const BAD_ARGUMENTS = { error: { code: 'COLLAB_BAD_ARGUMENTS' } }

/** Ordinary sessions M (owned) and W, a subagent S, an archived A; the integrator attaches `pet-locus`. */
async function begin(host: Host, options: { owns?: boolean } = {}) {
  host.session('M', { live: true }); host.session('W', { live: true })
  host.session('SUB', { live: true, header: SUBAGENT }); host.session('ARCH', { live: true })
  await start(host, { extra: { managedChannels: ['pet-locus'], memberTrust: true } })
  const scripted = scriptedAdapter(options)
  scripted.owned.add('M'); scripted.owned.add('SUB'); scripted.owned.add('ARCH')
  const handle = service(host).attach('pet-locus', scripted.adapter)
  return { scripted, handle }
}
const send = (handle: any, as: string, cmdId = 'x-1') => handle.actAs(as, 's', cmdId, { op: 'sendMessage', input: { to: 'w', body: 'hi' } })

describe('actAs：接入方以其拥有的普通会话身份执行封闭命令', () => {
  it('以拥有的会话建空间、邀请并代写', () => world(async host => {
    const { handle } = await begin(host)
    expect(await handle.actAs('M', 'sp', 'c1', { op: 'createSpace', input: { name: 'locus' } })).toMatchObject({ spaceId: 'sp' })
    expect(await handle.actAs('M', 'sp', 'c2', { op: 'invite', input: { name: 'work', address: 'W' } })).not.toHaveProperty('error')
    expect(await handle.actAs('M', 'sp', 'c3', { op: 'createItem', input: { itemId: 'todo-1', kind: 'request', assignee: 'work', title: 't', body: 'b', requiredAcks: [], ext: { pet: { entry: 'e1' } } } })).not.toHaveProperty('error')
    await settle()
    const log = await events(host, 'sp')
    expect(log.find((e: any) => e.type === 'space/created')).toMatchObject({ leader: 'locus' })
    expect(log.find((e: any) => e.type === 'member/joined' && e.member.name === 'locus').member.binding).toMatchObject({ channel: 'dsh-session', address: 'M' })
    expect(log.some((e: any) => e.type === 'member/invited' && e.member.name === 'work')).toBe(true)
    expect(log.some((e: any) => e.type === 'member/joined' && e.member.name === 'work')).toBe(true)
    expect(log.find((e: any) => e.type === 'item/created')).toMatchObject({ actor: 'locus', item: { id: 'todo-1', ext: { pet: { entry: 'e1' } } } })
    // allowManager is limited to this handle's channel and reads work as the owned session.
    expect(await handle.actAs('M', 'sp', 'c4', { op: 'allowManager', input: { channel: 'pet-locus' } })).not.toHaveProperty('error')
    expect(await handle.actAs('M', 'sp', 'c5', { op: 'read', input: { view: 'since', sinceSeq: 0 } })).toBeInstanceOf(Array)
  }))

  it('未拥有、子会话或已归档时拒绝', () => world(async host => {
    const { handle, scripted } = await begin(host)
    expect(await handle.actAs('M', 's', 'mk', { op: 'createSpace', input: { name: 'locus' } })).toMatchObject({ spaceId: 's' })
    host.archived.push('ARCH')
    const before = await bytes(ledger(host, 's'))
    expect(await send(handle, 'W')).toEqual(UNAVAILABLE)
    expect(await send(handle, 'SUB')).toEqual(UNAVAILABLE)
    expect(await send(handle, 'ARCH')).toEqual(UNAVAILABLE)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
    void scripted
  }))

  it('提交前失去拥有关系', () => world(async host => {
    const captured = captureHost()
    try {
      const { handle, scripted } = await begin(host)
      await handle.actAs('M', 's', 'mk', { op: 'createSpace', input: { name: 'locus' } })
      await handle.actAs('M', 's', 'iv', { op: 'invite', input: { name: 'w', address: 'W' } })
      await settle()
      const kernel: any = captured.seen.host!.service, original = kernel.sendMessage.bind(kernel)
      const g = gate()
      kernel.sendMessage = async (ctx: any, input: any) => { await g.wait(); return original(ctx, input) }
      const before = await bytes(ledger(host, 's'))
      const pending = send(handle, 'M', 'late')
      await g.reached
      scripted.owned.delete('M')
      g.release()
      expect(await pending).toEqual(UNAVAILABLE)
      await settle()
      expect(await bytes(ledger(host, 's'))).toEqual(before)
    } finally { captured.restore() }
  }))

  it('封闭操作集合', () => world(async host => {
    const { handle } = await begin(host)
    await handle.actAs('M', 's', 'mk', { op: 'createSpace', input: { name: 'locus' } })
    const before = await bytes(ledger(host, 's'))
    expect(await handle.actAs('M', 's', 'o1', { op: 'allowManager', input: { channel: 'other-loc' } })).toEqual(BAD_ARGUMENTS)
    expect(await handle.actAs('M', 's', 'o2', { op: 'markGone', input: { member: 'w' } })).toEqual(BAD_ARGUMENTS)
    expect(await handle.actAs('M', 's', 'o3', { op: 'closeSpace', input: {} })).toEqual(BAD_ARGUMENTS)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))

  it('未提供 owns 的接入方', () => world(async host => {
    const { handle } = await begin(host, { owns: false })
    expect(await handle.actAs('M', 's', 'mk', { op: 'createSpace', input: { name: 'locus' } })).toEqual(UNAVAILABLE)
    expect(await bytes(ledger(host, 's'))).toBeNull()
  }))

  it('disposeRequest 把 owns 作为 authorOwned 传入', () => world(async host => {
    const { handle } = await begin(host)
    await handle.actAs('M', 's', 'mk', { op: 'createSpace', input: { name: 'locus' } })
    await handle.actAs('M', 's', 'iv', { op: 'invite', input: { name: 'work', address: 'W' } })
    await handle.actAs('M', 's', 'g', { op: 'allowManager', input: { channel: 'pet-locus' } })
    await handle.actAs('M', 's', 't1', { op: 'createItem', input: { itemId: 'todo-1', kind: 'request', assignee: 'work', title: 't', body: '', requiredAcks: [] } })
    await handle.actAs('W', 's', 't2', { op: 'createItem', input: { itemId: 'todo-2', kind: 'request', assignee: 'locus', title: 't', body: '', requiredAcks: [] } }).catch(() => undefined)
    await settle()
    expect(await handle.disposeRequest('s', 'd1', { itemId: 'todo-1', progress: 'done' })).not.toHaveProperty('error')
    expect((await events(host, 's')).find((e: any) => e.type === 'request/progressed')).toMatchObject({ actor: 'manager:pet-locus', itemId: 'todo-1', progress: 'done' })
  }))
})
