import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { hostContext, start, call, ops, settle, tempRoot, bytes, exists, type Host } from './support/world.js'
import { captureHost, codeOf, events, gate, ledger, managedSpace, records, scriptedAdapter, service, SUBAGENT } from './support/integrator.js'

const world = (run: (host: Host) => Promise<void>) => tempRoot('collab-int-', async root => { const host = hostContext(root); try { await run(host) } finally { await host.stop() } })
const MANAGED = { extra: { managedChannels: ['pet-locus'] } }
const UNAVAILABLE = '{"error":{"code":"COLLAB_SPACE_UNAVAILABLE"}}'
let restore: (() => void) | undefined
afterEach(() => { restore?.(); restore = undefined })

describe('宿主声明可托管成员的接入方 channel', () => {
  it('attach-01：未声明的 channel 不能接入', () => world(async host => {
    await start(host, MANAGED)
    const collab = service(host)
    expect(await codeOf(() => collab.attach('other', scriptedAdapter().adapter))).toBe('COLLAB_BAD_CHANNEL')
    const handle = collab.attach('pet-locus', scriptedAdapter().adapter)
    expect(typeof handle.admit).toBe('function')
    expect(await codeOf(() => collab.attach('pet-locus', scriptedAdapter().adapter))).toBe('COLLAB_CHANNEL_ATTACHED')
    handle.dispose()
    expect(typeof collab.attach('pet-locus', scriptedAdapter().adapter).admit).toBe('function')
  }))

  it('attach-02：非法配置拒绝启动', async () => {
    for (const managedChannels of [['dsh-session'], ['Pet'], ['a', 'a'], 'pet-locus']) {
      await tempRoot('collab-int-', async root => {
        const host = hostContext(root)
        const dataDir = join(root, 'never')
        await expect(start(host, { extra: { managedChannels } }, dataDir)).rejects.toMatchObject({ code: 'COLLAB_BAD_CONFIG' })
        expect(host.tools.size).toBe(0)
        expect(host.services.has('dshCollab')).toBe(false)
        expect(await exists(dataDir)).toBe(false)
      })
    }
  })

  it('attach-03：接入方离开后不可投递', () => world(async host => {
    const { handle, scripted } = await managedSpace(host)
    handle.dispose()
    expect(await codeOf(handle.admit('s', 'adm-2', { name: 'locus-b', address: 'loc:2' }))).toBe('COLLAB_CHANNEL_DETACHED')
    const sent = await ops(host).send('session-a', 's', 'locus-a', 'are you there', true)
    expect(sent.error).toBeUndefined()
    await settle()
    const commit = (await records(host, 's')).find((r: any) => r.seq === sent.seq)
    expect(commit.events.some((e: any) => e.type === 'dispatch/intended')).toBe(false)
    expect((await ops(host).overview('session-a', 's')).presence['locus-a']).toBe('unreachable')
    expect(scripted.calls.deliver).toBe(0)
  }))

  it('attach-05：插件 dispose 时先使全部句柄失效', () => tempRoot('collab-int-', async root => {
    const host = hostContext(root)
    const { handle, L } = await managedSpace(host)
    let detachedAtClose: unknown
    const captured = host.services.get('dshCollab')
    expect(captured).toBeDefined()
    // Observe the handle state at the moment the first space starts closing.
    const kernel = await import('collab-kernel')
    const original = kernel.CollabService.prototype.close
    kernel.CollabService.prototype.close = async function (this: any, id: string) { detachedAtClose ??= await handle.admit('s', 'late', { name: 'late', address: 'loc:8' }); return original.call(this, id) }
    try { await host.stop() } finally { kernel.CollabService.prototype.close = original }
    expect(detachedAtClose).toEqual({ error: { code: 'COLLAB_CHANNEL_DETACHED' } })
    expect(await handle.command({ agent: L }, 's', 'after', { op: 'setStatus', input: { text: 'x' } })).toEqual({ error: { code: 'COLLAB_CHANNEL_DETACHED' } })
    expect(await codeOf(() => captured.attach('pet-locus', scriptedAdapter().adapter))).toBe('COLLAB_SERVICE_CLOSING')
  }))

  it('attach-04：未声明托管 channel 时工具面与行为不变', () => tempRoot('collab-int-', async root => {
    const schema = async (extra: Record<string, unknown>) => {
      const host = hostContext(join(root, String(Math.random()).slice(2)))
      await import('node:fs/promises').then(fs => fs.mkdir(host.root, { recursive: true }))
      const captured = captureHost()
      try {
        await start(host, { extra })
        const tools = [...host.tools.values()].map(t => ({ name: t.name, description: t.description, parameters: t.parameters })).sort((a, b) => a.name < b.name ? -1 : 1)
        return { tools, providers: captured.seen.providers!.map(p => p.id), host }
      } finally { captured.restore() }
    }
    const plain = await schema({}), managed = await schema({ managedChannels: ['pet-locus'] })
    try {
      expect(plain.providers).toEqual(['dsh-session'])
      expect(managed.providers).toEqual(['dsh-session', 'dsh-collab:pet-locus'])
      expect(JSON.stringify(plain.tools)).toBe(JSON.stringify(managed.tools))
      expect(plain.tools).toHaveLength(11)
      // The existing ordinary flow is unchanged without managedChannels.
      const host = plain.host
      host.session('session-a', { live: true }); host.session('session-b', { live: true })
      const op = ops(host)
      expect(await op.create('session-a', 's', 'a')).toEqual({ seq: 1, spaceId: 's' })
      expect(await op.invite('session-a', 's', 'b', 'session-b')).toEqual({ seq: 2, spaceId: 's', autoJoined: true }); await settle()
      expect((await op.send('session-a', 's', 'b', 'ping', true)).error).toBeUndefined(); await settle()
      expect(host.followups.filter(f => f.id === 'session-b')).toHaveLength(2)
      expect(await codeOf(call(host, 'session-a', 'collab_space', { action: 'allow_manager', spaceId: 's', cmdId: 'al-1', channel: 'pet-locus' }))).toBe('COLLAB_BAD_CHANNEL')
      expect(await codeOf(() => service(host).attach('pet-locus', scriptedAdapter().adapter))).toBe('COLLAB_BAD_CHANNEL')
    } finally { await plain.host.stop(); await managed.host.stop() }
  }))
})

describe('接入方经句柄托管成员', () => {
  it('handle-01：Leader 授权后接入方接纳成员', () => world(async host => {
    const { handle } = await managedSpace(host, { admit: false })
    const first = await handle.admit('s', 'adm-1', { name: 'locus-a', address: 'loc:1' })
    expect(first.error).toBeUndefined()
    await settle()
    const before = await bytes(ledger(host, 's'))
    expect(await handle.admit('s', 'adm-1', { name: 'locus-a', address: 'loc:1' })).toEqual(first)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
    const all = await events(host, 's')
    expect(all.some((e: any) => e.type === 'manager/allowed' && e.channel === 'pet-locus')).toBe(true)
    const joined = all.find((e: any) => e.type === 'member/joined' && e.member.name === 'locus-a')
    expect(joined.actor).toBe('manager:pet-locus')
    expect(joined.member.managedBy).toBe('pet-locus')
    expect(all.some((e: any) => e.type === 'dispatch/intended')).toBe(false)
  }))

  it('handle-02：未授权空间的响应完全一致', () => tempRoot('collab-int-', async root => {
    const dataDir = join(root, 'data')
    const failSync = (store: any, spaceId: string) => {
      const io = store.fs, open = io.open.bind(io)
      io.open = async (...args: any[]) => { const handle = await open(...args); if (args[0] !== join(dataDir, `${spaceId}.jsonl`) || args[1] !== 'a') return handle; return new Proxy(handle, { get(t, k) { if (k === 'sync') return async () => { throw new Error('injected fsync failure') }; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v } }) }
      return () => { io.open = open }
    }
    let host = hostContext(root)
    host.session('session-a', { live: true })
    let captured = captureHost()
    try {
      await start(host, MANAGED)
      const op = ops(host)
      for (const id of ['s1', 's2', 's5']) await op.create('session-a', id, 'aily')
      await op.close('session-a', 's2')
    } finally { captured.restore(); await host.stop() }
    await writeFile(join(dataDir, 's3.jsonl'), ''); await writeFile(join(dataDir, 's3.lock'), JSON.stringify({ instanceId: 'foreign', pid: process.pid }))
    await writeFile(join(dataDir, 's4.jsonl'), 'not a record\n')
    host = hostContext(root)
    host.session('session-a', { live: true })
    captured = captureHost()
    try {
      await start(host, MANAGED)
      const scripted = scriptedAdapter(); scripted.held.add('loc:1')
      const handle = service(host).attach('pet-locus', scripted.adapter)
      const undo = failSync(captured.seen.host!.store, 's5')
      expect(await codeOf(ops(host).setStatus('session-a', 's5', 'x'))).toBe('COLLAB_SPACE_UNAVAILABLE')
      undo()
      const ids = ['s1', 's2', 's3', 's4', 's5', 's6']
      const before = await Promise.all(ids.map(id => bytes(join(dataDir, `${id}.jsonl`))))
      const responses: string[] = []
      for (const id of ids) responses.push(JSON.stringify(await handle.admit(id, `adm-${id}`, { name: 'locus-a', address: 'loc:1' })))
      expect(responses).toEqual(ids.map(() => UNAVAILABLE))
      expect(await Promise.all(ids.map(id => bytes(join(dataDir, `${id}.jsonl`))))).toEqual(before)
    } finally { captured.restore(); await host.stop() }
  }))

  it('handle-03：旧句柄的在途托管命令不提交', () => world(async host => {
    const { handle: h1, scripted: first } = await managedSpace(host, { admit: false })
    const g = gate()
    // H1's adapter keeps holding loc:9: only the attach epoch can fence the stale command.
    first.held.add('loc:9')
    first.hooks.claim = async () => { await g.wait(); return true }
    const pending = h1.admit('s', 'adm-9', { name: 'locus-z', address: 'loc:9' })
    await g.reached
    const before = await bytes(ledger(host, 's'))
    h1.dispose()
    const second = scriptedAdapter(); second.held.add('loc:9')
    const h2 = service(host).attach('pet-locus', second.adapter)
    g.release()
    expect(await pending).toEqual({ error: { code: 'COLLAB_CHANNEL_DETACHED' } })
    expect(await bytes(ledger(host, 's'))).toEqual(before)
    const admitted = await h2.admit('s', 'adm-9', { name: 'locus-z', address: 'loc:9' })
    expect(admitted.error).toBeUndefined()
    expect(admitted.seq).toBeGreaterThan(0)
  }))

  it('handle-03：旧句柄的在途托管命令不提交（认领已完成、停在串行队列）', () => world(async host => {
    const captured = captureHost(); restore = captured.restore
    const { handle: h1, scripted: first } = await managedSpace(host, { admit: false })
    first.held.add('loc:9')
    // Hold the space's serial queue with a slow commit of an unrelated command.
    const store: any = captured.seen.host!.store, commit = store.commit
    const g = gate()
    store.commit = async (...args: any[]) => { store.commit = commit; await g.wait(); return commit(...args) }
    const blocking = ops(host).setStatus('session-a', 's', 'busy')
    await g.reached
    const pending = h1.admit('s', 'adm-9', { name: 'locus-z', address: 'loc:9' })
    for (let i = 0; i < 50 && first.calls.claim === 0; i++) await settle(1)
    await settle()
    expect(first.calls.claim).toBe(1)
    h1.dispose()
    const second = scriptedAdapter(); second.held.add('loc:9')
    const h2 = service(host).attach('pet-locus', second.adapter)
    g.release()
    expect((await blocking).error).toBeUndefined()
    const before = await bytes(ledger(host, 's'))
    expect(await pending).toEqual({ error: { code: 'COLLAB_CHANNEL_DETACHED' } })
    expect(await bytes(ledger(host, 's'))).toEqual(before)
    expect((await events(host, 's')).some((e: any) => e.type === 'member/joined' && e.member.name === 'locus-z')).toBe(false)
    expect((await h2.admit('s', 'adm-9', { name: 'locus-z', address: 'loc:9' })).seq).toBeGreaterThan(0)
  }))

  it('handle-04：认领后、提交前地址被撤回', () => world(async host => {
    const { handle, scripted } = await managedSpace(host, { admit: false })
    scripted.held.add('loc:3')
    // The claim succeeds, then the integrator stops holding the address before the transaction.
    scripted.hooks.claim = async address => { const ok = scripted.held.has(address); scripted.held.delete(address); return ok }
    const before = await bytes(ledger(host, 's'))
    expect(await handle.admit('s', 'adm-3', { name: 'locus-c', address: 'loc:3' })).toEqual({ error: { code: 'COLLAB_ADDRESS_UNCLAIMED' } })
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))

  it('handle-05：句柄没有 Leader 能力', () => world(async host => {
    await start(host, MANAGED)
    const handle = service(host).attach('pet-locus', scriptedAdapter().adapter)
    expect(Object.keys(handle).sort()).toEqual(['admit', 'command', 'dispose', 'read', 'rebind', 'registerSessionMode', 'retire'])
    for (const name of ['allowManager', 'revokeManager', 'invite', 'markGone', 'transferLeader', 'closeSpace']) expect(name in handle).toBe(false)
    expect(Object.keys(service(host)).sort()).toEqual(['attach'])
  }))
})

describe('接入方以真实调用会话执行带附加数据的命令', () => {
  it('hcommand-01：托管成员写入带来源的请求', () => world(async host => {
    const { handle, L } = await managedSpace(host)
    const result = await handle.command({ agent: L }, 's', 'c-1', { op: 'createItem', input: { itemId: 'todo-1', kind: 'request', assignee: 'aily', title: '回复群消息', body: '…', requiredAcks: [], ext: { source: { msg: 'om_2' } } } })
    expect(result.error).toBeUndefined()
    const created = (await events(host, 's')).find((e: any) => e.type === 'item/created')
    expect(created.actor).toBe('locus-a')
    expect(created.item.ext).toEqual({ source: { msg: 'om_2' } })
  }))

  it('hcommand-02：只能使用本 channel 的投递方式', () => world(async host => {
    const captured = captureHost(); restore = captured.restore
    const { handle, L } = await managedSpace(host)
    const kernel: any = captured.seen.host!.service, original = kernel.sendMessage.bind(kernel)
    let received = 0
    kernel.sendMessage = (...args: any[]) => { received++; return original(...args) }
    const before = await bytes(ledger(host, 's'))
    expect(await handle.command({ agent: L }, 's', 'm-1', { op: 'sendMessage', input: { to: 'aily', body: 'q', needsReply: true, mode: 'other:inquiry' } })).toEqual({ error: { code: 'COLLAB_BAD_MODE' } })
    expect(received).toBe(0)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))

  it('hcommand-03：模型工具不接受附加数据与方式', () => world(async host => {
    const captured = captureHost(); restore = captured.restore
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    await start(host, MANAGED); const op = ops(host)
    await op.create('session-a', 's', 'a'); await op.invite('session-a', 's', 'b', 'session-b'); await settle()
    const kernel: any = captured.seen.host!.service
    let received = 0
    for (const method of ['sendMessage', 'createItem']) { const original = kernel[method].bind(kernel); kernel[method] = (...args: any[]) => { received++; return original(...args) } }
    for (const extra of [{ ext: { a: 1 } }, { mode: 'pet-locus:inquiry' }]) {
      expect(await codeOf(op.send('session-a', 's', 'b', 'hi', true, undefined, extra))).toBe('COLLAB_BAD_ARGUMENTS')
      expect(await codeOf(op.createItem('session-a', 's', { itemId: 'x-1', ...extra }))).toBe('COLLAB_BAD_ARGUMENTS')
    }
    expect(received).toBe(0)
  }))

  it('hcommand-04：换代后的新会话可凭原 cmdId 确定结果', () => world(async host => {
    const { handle, scripted, L } = await managedSpace(host)
    const input = { op: 'createItem', input: { itemId: 'note-9', kind: 'other', title: 'T', body: 'B', requiredAcks: [], ext: { k: 1 } } }
    const first = await handle.command({ agent: L }, 's', 'c-9', input)
    expect(first.error).toBeUndefined()
    host.session('session-l2', { live: true, header: SUBAGENT })
    const L2 = host.live.get('session-l2')
    scripted.bind(L2, 'loc:2')
    expect((await handle.rebind('s', 'rb-1', { member: 'locus-a', address: 'loc:2' })).error).toBeUndefined()
    scripted.unbind(L)
    await settle()
    const before = await bytes(ledger(host, 's'))
    expect(await handle.command({ agent: L2 }, 's', 'c-9', input)).toEqual(first)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
    // The old session lost its identity with the binding.
    expect(await codeOf(handle.command({ agent: L }, 's', 'c-10', input))).toBe('COLLAB_CALLER_UNAVAILABLE')
  }))

  it('hcommand-05：不能经句柄执行成员管理', () => world(async host => {
    const { handle, L } = await managedSpace(host)
    const before = await bytes(ledger(host, 's'))
    for (const op of ['invite', 'allowManager', 'join', 'markGone', 'closeSpace', 'createSpace', 'constructor', '__proto__']) {
      expect(await codeOf(handle.command({ agent: L }, 's', `h-${op}`, { op, input: { name: 'x', address: 'y', kind: 'agent', channel: 'pet-locus' } }))).toBe('COLLAB_BAD_ARGUMENTS')
    }
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))
})
