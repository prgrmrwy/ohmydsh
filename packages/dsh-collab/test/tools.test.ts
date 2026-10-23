import { it, expect, describe } from 'vitest'
import { join } from 'node:path'
import { collabTools, safeError } from '../src/tools.js'
import { CollabError, FileStore } from 'collab-kernel'
import { hostContext, start, call, ops, settle, tempRoot, bytes, direct, type Host } from './support/world.js'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { canonical } from '../../collab-kernel/src/service/index.js'

const NAMES = ['collab_status', 'collab_space', 'collab_invite', 'collab_member', 'collab_read', 'collab_create_item', 'collab_revise_item', 'collab_ack_item', 'collab_send_message', 'collab_set_status', 'collab_advance_request']
const codeOf = async (run: Promise<any>) => { try { const value = await run; return value?.error?.code ?? 'OK' } catch (error: any) { return error?.code ?? 'THROWN' } }
const ledger = (host: Host, spaceId: string) => join(host.root, 'data', `${spaceId}.jsonl`)
const world = (run: (host: Host) => Promise<void>) => tempRoot('collab-tools-', async root => { const host = hostContext(root); try { await run(host) } finally { await host.stop() } })

it('tool-contract: exactly eleven named tools, unknown identity fields rejected before Host reads', async () => {
  let calls = 0
  const tools: any[] = []
  collabTools({ tools: { register(tool: any) { tools.push(tool) } } } as any, { caller: async () => { calls++; return 'a' } } as any, undefined as any)
  expect(tools.map(x => x.name).sort()).toEqual([...NAMES].sort())
  expect(tools.map(x => x.name).some((name: string) => /confirm|reset|break|execute|project|sessions/.test(name))).toBe(false)
  const values: Record<string, unknown> = { spaceId: 's', cmdId: 'c', name: 'A', recipientSessionId: 'b', member: 'b', itemId: 'i', kind: 'other', title: 'T', body: 'B', requiredAcks: [], deciders: [], assignee: 'b', expectedRevision: 1, changes: { title: 'T' }, revision: 1, to: 'b', needsReply: false, text: 'working', progress: 'open', options: ['yes', 'no'], sinceSeq: 0, version: '1', action: undefined, view: undefined }
  for (const tool of tools) {
    expect(Object.keys(tool.parameters.properties).filter(key => ['actor', 'principal', 'providerId', 'sessionId'].includes(key))).toEqual([])
    const valid = Object.fromEntries(Object.keys(tool.parameters.properties).map(key => [key, values[key]]).filter(([, v]) => v !== undefined))
    if (tool.name === 'collab_space') Object.assign(valid, { action: 'create' })
    if (tool.name === 'collab_member') { Object.assign(valid, { action: 'join' }); delete valid.member }
    if (tool.name === 'collab_read') { Object.assign(valid, { view: 'overview' }); delete valid.sinceSeq; delete valid.version }
    for (const field of ['actor', 'principal', 'providerId', 'sessionId']) await expect(tool.execute({ ...valid, [field]: 'forged' }, {})).rejects.toMatchObject({ code: 'COLLAB_BAD_ARGUMENTS' })
  }
  const space = tools.find(x => x.name === 'collab_space')
  for (const cmdId of ['', '   ']) await expect(space.execute({ action: 'create', spaceId: 's', cmdId, name: 'A' }, {})).rejects.toMatchObject({ code: 'COLLAB_BAD_CMD_ID' })
  expect(calls).toBe(0)
})

it('tool-mapping: every closed enum value invokes its exact kernel method with the actual caller principal', async () => {
  const tools: any[] = [], calls: any[] = []
  const service: any = new Proxy({}, { get: (_target, method) => async (...args: unknown[]) => { calls.push({ method, args }); return { ok: true } } })
  const host: any = { context: (id: string, spaceId: string, cmdId: string) => ({ principal: { kind: 'agent', channel: 'dsh-session', address: id }, spaceId, cmdId }), command: (_id: string, _space: string, _cmd: string, run: any) => run(service), read: (_id: string, _space: string, run: any) => run(service), failed: () => false }
  collabTools({ tools: { register(tool: any) { tools.push(tool); return () => {} } } } as any, { caller: () => 'actual-b' } as any, () => host)
  const rows: [string, Record<string, unknown>, string, unknown, boolean][] = [
    ['collab_space', { action: 'create', name: 'b' }, 'createSpace', { name: 'b', address: 'actual-b', kind: 'agent' }, true],
    ['collab_space', { action: 'close' }, 'closeSpace', undefined, true],
    ['collab_invite', { name: 'a', recipientSessionId: 'target-a' }, 'invite', { name: 'a', address: 'target-a', kind: 'agent' }, true],
    ['collab_member', { action: 'join' }, 'join', undefined, true], ['collab_member', { action: 'decline' }, 'declineInvite', undefined, true], ['collab_member', { action: 'leave' }, 'leave', undefined, true],
    ['collab_member', { action: 'mark_gone', member: 'a' }, 'markGone', { member: 'a' }, true], ['collab_member', { action: 'transfer_leader', member: 'a' }, 'transferLeader', { member: 'a' }, true],
    ['collab_create_item', { itemId: 'i', kind: 'request', title: 'T', body: 'B', requiredAcks: [], deciders: [], assignee: 'a' }, 'createItem', { itemId: 'i', kind: 'request', title: 'T', body: 'B', requiredAcks: [], deciders: [], assignee: 'a' }, true],
    ['collab_revise_item', { itemId: 'i', expectedRevision: 2, changes: { title: 'T2' } }, 'reviseItem', { itemId: 'i', expectedRevision: 2, changes: { title: 'T2' } }, true],
    ['collab_ack_item', { itemId: 'i', revision: 2 }, 'ackItem', { itemId: 'i', revision: 2 }, true],
    ['collab_send_message', { to: 'a', body: 'B', needsReply: true }, 'sendMessage', { to: 'a', body: 'B', needsReply: true }, true],
    ['collab_set_status', { text: 'working' }, 'setStatus', { text: 'working' }, true],
    ['collab_advance_request', { itemId: 'i', progress: 'done' }, 'advanceRequest', { itemId: 'i', progress: 'done' }, true],
    ['collab_create_item', { itemId: 'i', kind: 'other', title: 'T', body: 'B', requiredAcks: [] }, 'createItem', { itemId: 'i', kind: 'other', title: 'T', body: 'B', requiredAcks: [] }, true],
    ['collab_create_item', { itemId: 'i', kind: 'other', title: 'T', body: 'B', requiredAcks: [], ref: 4 }, 'createItem', { itemId: 'i', kind: 'other', title: 'T', body: 'B', requiredAcks: [], ref: 4 }, true],
    ['collab_revise_item', { itemId: 'i', expectedRevision: 2, changes: { deciders: [] } }, 'reviseItem', { itemId: 'i', expectedRevision: 2, changes: { deciders: [] } }, true],
    ['collab_send_message', { to: 'a', body: 'B', needsReply: true, ref: 9999 }, 'sendMessage', { to: 'a', body: 'B', needsReply: true, ref: 9999 }, true],
    ['collab_space', { action: 'create', name: 'b', purpose: ' p ' }, 'createSpace', { name: 'b', address: 'actual-b', kind: 'agent', purpose: ' p ' }, true],
    ['collab_read', { view: 'overview' }, 'overview', undefined, false], ['collab_read', { view: 'since', sinceSeq: 3 }, 'readSince', 3, false], ['collab_read', { view: 'convention', version: '1' }, 'readConvention', '1', false],
  ]
  for (const [name, args, method, input, write] of rows) {
    await tools.find(x => x.name === name).execute({ spaceId: 's', ...(write ? { cmdId: 'c' } : {}), ...args }, {})
    const last = calls.at(-1)
    expect(last.method, `${name}/${JSON.stringify(args)}`).toBe(method)
    expect(last.args[0]).toMatchObject({ principal: { kind: 'agent', channel: 'dsh-session', address: 'actual-b' }, spaceId: 's' })
    expect(last.args.length).toBe(input === undefined ? 1 : 2)
    if (input !== undefined) expect(last.args[1]).toEqual(input)
  }
  expect(calls).toHaveLength(rows.length)
})

it('tool-no-caller: read and write bodies refuse missing execution identity before data lookup', async () => {
  const tools: any[] = []
  const access: any = { caller(exec: any) { if (!exec.agent) throw new CollabError('COLLAB_CALLER_UNAVAILABLE'); return 'a' } }
  let reads = 0
  collabTools({ tools: { register(tool: any) { tools.push(tool); return () => {} } } } as any, access, () => { reads++; return undefined })
  for (const [name, args] of [['collab_read', { view: 'overview', spaceId: 'secret' }], ['collab_space', { action: 'create', spaceId: 'secret', cmdId: 'c', name: 'a' }], ['collab_status', {}]] as const) {
    expect((await tools.find(tool => tool.name === name).execute(args, {})).error.code).toBe('COLLAB_CALLER_UNAVAILABLE')
  }
  expect(reads).toBe(0)
})

it('tool-error: native failures, lock identity and paths never enter model data', async () => {
  const tools: any[] = []
  collabTools({ tools: { register(tool: any) { tools.push(tool); return () => {} } } } as any, { caller() { throw new Error('/private/secret/credentials') } } as any, () => undefined)
  expect(await tools.find(x => x.name === 'collab_read').execute({ view: 'overview', spaceId: 's' }, {})).toEqual({ error: { code: 'COLLAB_HOST_ERROR' } })
  const locked = new CollabError('COLLAB_STORE_LOCKED', { lockPath: '/private/data/s.lock', lock: { instanceId: 'instance', pid: 123 } })
  expect(safeError(locked)).toEqual({ code: 'COLLAB_SPACE_UNAVAILABLE' })
  expect(safeError(new CollabError('COLLAB_STALE_REVISION', { currentRevision: 2, lockPath: '/x' }))).toEqual({ code: 'COLLAB_STALE_REVISION', details: { currentRevision: 2 } })
})

describe('named tools adapt the kernel faithfully', () => {
  it('tool-01：创建邀请加入与协商闭环', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    await start(host); const op = ops(host)
    expect(await op.create('session-a', 's', 'a')).toEqual({ seq: 1, spaceId: 's' })
    expect(await op.invite('session-a', 's', 'b', 'session-b')).toEqual({ seq: 2, spaceId: 's', autoJoined: true }); await settle()
    expect((await op.createItem('session-a', 's', { itemId: 'item-1', requiredAcks: ['b'] })).itemId).toBe('item-1')
    expect((await op.ack('session-b', 's', 'item-1', 1)).error).toBeUndefined()
    const [viewA, viewB] = [await op.overview('session-a', 's'), await op.overview('session-b', 's')]
    expect(viewA.items['item-1']).toMatchObject({ status: 'agreed', revision: 1, acks: { b: 1 } })
    expect(viewB.items).toEqual(viewA.items)
    expect((await op.since('session-b', 's', 0)).map((r: any) => r.seq)).toEqual((await op.since('session-a', 's', 0)).map((r: any) => r.seq))
  }))
  it('tool-02：相同命令结果未知后重试', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b', { live: true }); host.session('session-c', { live: true })
    await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a')
    await op.invite('session-a', 's', 'c', 'session-c'); await settle(); await op.join('session-c', 's')
    const first = await op.invite('session-a', 's', 'b', 'session-b', 'inv-1'); await settle()
    await op.member('session-a', 's', 'transfer_leader', { member: 'c' }); await settle()
    const wakes = host.followups.filter(f => f.id === 'session-b').length
    const before = (await op.since('session-a', 's', 0)).filter((r: any) => r.kind === 'command').length
    expect(await op.invite('session-a', 's', 'b', 'session-b', 'inv-1')).toEqual(first)
    await settle()
    expect((await op.since('session-a', 's', 0)).filter((r: any) => r.kind === 'command').length).toBe(before)
    expect(host.followups.filter(f => f.id === 'session-b').length).toBe(wakes)
  }))
  it('tool-03：枚举取值与字段不匹配被拒绝', () => world(async host => {
    host.session('session-a', { live: true }); await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a'); const before = await bytes(ledger(host, 's'))
    expect(await codeOf(call(host, 'session-a', 'collab_member', { action: 'transfer_leader', spaceId: 's', cmdId: 'x1' }))).toBe('COLLAB_BAD_ARGUMENTS')
    expect(await codeOf(call(host, 'session-a', 'collab_member', { action: 'join', spaceId: 's', cmdId: 'x2', member: 'a' }))).toBe('COLLAB_BAD_ARGUMENTS')
    expect(await codeOf(call(host, 'session-a', 'collab_space', { action: 'close', spaceId: 's', cmdId: 'x3', name: 'a' }))).toBe('COLLAB_BAD_ARGUMENTS')
    expect(await codeOf(call(host, 'session-a', 'collab_space', { action: 'create', spaceId: 'n', cmdId: 'x4' }))).toBe('COLLAB_BAD_ARGUMENTS')
    expect(await codeOf(call(host, 'session-a', 'collab_read', { view: 'since', spaceId: 's' }))).toBe('COLLAB_BAD_ARGUMENTS')
    expect(await codeOf(call(host, 'session-a', 'collab_read', { view: 'overview', spaceId: 's', version: '1' }))).toBe('COLLAB_BAD_ARGUMENTS')
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))
  it('tool-04：旧命令的重试不被插件挡住', () => world(async host => {
    host.session('session-a', { live: true }); await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a')
    const first = await op.createItem('session-a', 's', { itemId: 'Old Item', title: 'old' }, 'c-1')
    expect(first.itemId).toBe('Old Item')
    const before = await bytes(ledger(host, 's'))
    expect(await op.createItem('session-a', 's', { itemId: 'Old Item', title: 'old' }, 'c-1')).toEqual(first)
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))
  it('tool-07：ref 与 purpose 原样传给内核', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    const assembled = await direct(host)
    try {
      const op = ops(host)
      expect((await call(host, 'session-a', 'collab_space', { action: 'create', spaceId: 's', cmdId: 'p-1', name: 'a', purpose: '接口协作' })).seq).toBe(1)
      await op.invite('session-a', 's', 'b', 'session-b'); await settle()
      const asked = await op.send('session-a', 's', 'b', 'question', true); await settle()
      expect(asked.seq).toBeGreaterThan(0)
      const service: any = assembled.collab.service, inputs: any[] = [], original = service.sendMessage.bind(service)
      service.sendMessage = (ctx: any, input: any) => { inputs.push(structuredClone(input)); return original(ctx, input) }
      const answered = await op.send('session-b', 's', 'a', 'answer', false, 'ref-ok', { ref: asked.seq })
      expect(answered.error).toBeUndefined(); expect(answered.seq).toBeGreaterThan(asked.seq)
      expect(inputs[0]).toEqual({ to: 'a', body: 'answer', needsReply: false, ref: asked.seq })
      await settle()
      const before = await bytes(ledger(host, 's'))
      expect(await op.send('session-b', 's', 'a', 'dangling', false, 'ref-bad', { ref: 9999 })).toEqual({ error: { code: 'COLLAB_BAD_REF' } })
      expect(inputs[1]).toMatchObject({ ref: 9999 })
      expect(await bytes(ledger(host, 's'))).toEqual(before)
      expect((await op.overview('session-a', 's')).purpose).toBe('接口协作')
    } finally { await assembled.close() }
  }))
  it('tool-08：升级前的创建重试仍命中收据', () => world(async host => {
    host.session('session-a', { live: true })
    const dataDir = join(host.root, 'data')
    let assembled = await direct(host, {}, dataDir)
    expect((await ops(host).create('session-a', 's', 'a')).seq).toBe(1)
    await assembled.close()
    // Pre-change plugin call: deciders was required, so the old kernel hashed it into the payload.
    const args = { spaceId: 's', cmdId: 'c-9', itemId: 'item-9', kind: 'other', title: 'old title', body: 'old body', requiredAcks: [], deciders: [] }
    const input = { itemId: args.itemId, title: args.title, body: args.body, requiredAcks: args.requiredAcks, deciders: args.deciders, kind: args.kind }
    const result = { seq: 2, spaceId: 's', itemId: 'item-9' }
    const store = new FileStore(dataDir)
    await store.open('s')
    await store.commit('s', {
      kind: 'command', seq: 2,
      events: [{ type: 'item/created', actor: 'a', item: { id: 'item-9', kind: 'other', author: 'a', title: 'old title', body: 'old body', revision: 1, status: 'draft', requiredAcks: [], acks: {}, deciders: [], agentEditCount: 0 } }],
      receipt: { cmdId: 'c-9', scope: { kind: 'member', name: 'a' }, payloadHash: createHash('sha256').update(canonical({ name: 'createItem', input })).digest('hex'), result },
    } as any, 1)
    await store.close('s')
    assembled = await direct(host, {}, dataDir)
    try {
      const before = await bytes(ledger(host, 's'))
      expect(await call(host, 'session-a', 'collab_create_item', args)).toEqual(result)
      expect(await bytes(ledger(host, 's'))).toEqual(before)
      expect(await call(host, 'session-a', 'collab_create_item', { ...args, title: 'changed title' })).toEqual({ error: { code: 'COLLAB_CMD_CONFLICT' } })
      expect(await bytes(ledger(host, 's'))).toEqual(before)
      expect(await call(host, 'session-a', 'collab_create_item', { ...args, cmdId: 'c-10', itemId: 'item-10' })).toEqual({ error: { code: 'COLLAB_BAD_ITEM', details: { field: 'deciders' } } })
      expect(await bytes(ledger(host, 's'))).toEqual(before)
      const lines = (await readFile(ledger(host, 's'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      expect(lines.some((r: any) => r.receipt?.cmdId === 'c-10')).toBe(false)
      expect(lines.flatMap((r: any) => r.events).some((e: any) => e.type === 'dispatch/intended')).toBe(false)
    } finally { await assembled.close() }
  }))
  it('tool-09：不填 ref 时输入不含该键', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    const assembled = await direct(host)
    try {
      const op = ops(host)
      await op.create('session-a', 's', 'a'); await op.invite('session-a', 's', 'b', 'session-b'); await settle()
      const service: any = assembled.collab.service, inputs: any[] = []
      for (const method of ['sendMessage', 'createItem', 'createSpace']) { const original = service[method].bind(service); service[method] = (ctx: any, input: any) => { inputs.push([method, structuredClone(input)]); return original(ctx, input) } }
      expect((await op.send('session-a', 's', 'b', 'hello')).error).toBeUndefined()
      expect((await op.createItem('session-a', 's', { itemId: 'item-1' })).error).toBeUndefined()
      expect((await op.create('session-a', 't', 'a')).error).toBeUndefined()
      expect(inputs.map(([method]) => method)).toEqual(['sendMessage', 'createItem', 'createSpace'])
      expect(Object.hasOwn(inputs[0][1], 'ref')).toBe(false)
      expect(Object.hasOwn(inputs[1][1], 'ref')).toBe(false)
      expect(Object.hasOwn(inputs[1][1], 'deciders')).toBe(false)
      expect(Object.hasOwn(inputs[2][1], 'purpose')).toBe(false)
    } finally { await assembled.close() }
  }))
  it('tool-10：超出话题上限原样返回', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a'); await op.invite('session-a', 's', 'b', 'session-b'); await settle()
    const root = await op.send('session-a', 's', 'b', 'topic root', true); await settle()
    expect(root.error).toBeUndefined()
    for (let i = 2; i <= 20; i++) { expect((await op.send('session-a', 's', 'b', `turn ${i}`, true, undefined, { ref: root.seq })).error).toBeUndefined(); await settle() }
    const wakes = host.followups.filter(f => f.id === 'session-b').length
    const before = await bytes(ledger(host, 's'))
    expect(await op.send('session-a', 's', 'b', 'turn 21', true, undefined, { ref: root.seq })).toEqual({ error: { code: 'COLLAB_THREAD_LIMIT' } })
    await settle()
    expect(await bytes(ledger(host, 's'))).toEqual(before)
    expect(host.followups.filter(f => f.id === 'session-b').length).toBe(wakes)
  }))
})

describe('error disclosure', () => {
  it('disclose-01：无权空间的响应完全一致', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-c', { live: true })
    const dataDir = join(host.root, 'data')
    const assembled = await direct(host, {}, dataDir)
    const op = ops(host)
    try {
      for (const id of ['s1', 's2', 's5']) await op.create('session-a', id, 'a')
      await op.close('session-a', 's2')
      const io = (assembled.collab.store as any).fs, open = io.open.bind(io)
      io.open = async (...args: any[]) => { const handle = await open(...args); if (args[0] !== join(dataDir, 's5.jsonl') || args[1] !== 'a') return handle; return new Proxy(handle, { get(t, k) { if (k === 'sync') return async () => { throw new Error('injected fsync failure') }; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v } }) }
      expect(await codeOf(op.setStatus('session-a', 's5', 'x'))).toBe('COLLAB_SPACE_UNAVAILABLE')
      io.open = open
    } finally { await assembled.close() }
    // Restart: S3 held by a live foreign process, S4 corrupt in the middle.
    await writeFile(join(dataDir, 's3.jsonl'), ''); await writeFile(join(dataDir, 's3.lock'), JSON.stringify({ instanceId: 'foreign', pid: process.pid }))
    await writeFile(join(dataDir, 's4.jsonl'), 'not a record\n')
    const restarted = await direct(host, {}, dataDir)
    try {
      // S5 must be unavailable in the running Host: fail it again after restart.
      const io = (restarted.collab.store as any).fs, open = io.open.bind(io)
      io.open = async (...args: any[]) => { const handle = await open(...args); if (args[0] !== join(dataDir, 's5.jsonl') || args[1] !== 'a') return handle; return new Proxy(handle, { get(t, k) { if (k === 'sync') return async () => { throw new Error('injected fsync failure') }; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v } }) }
      expect(await codeOf(op.setStatus('session-a', 's5', 'y'))).toBe('COLLAB_SPACE_UNAVAILABLE')
      io.open = open
      const responses: string[] = []
      for (const id of ['s1', 's2', 's3', 's4', 's5', 's6']) {
        responses.push(JSON.stringify(await op.overview('session-c', id)))
        responses.push(JSON.stringify(await op.send('session-c', id, 'a', 'hello')))
      }
      expect(responses).toHaveLength(12)
      expect(new Set(responses)).toEqual(new Set(['{"error":{"code":"COLLAB_SPACE_UNAVAILABLE"}}']))
    } finally { await restarted.close() }
  }))
  it('disclose-02：成员仍得到业务错误', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b', { live: true })
    await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a'); await op.invite('session-a', 's', 'b', 'session-b'); await settle(); await op.join('session-b', 's')
    await op.createItem('session-a', 's', { itemId: 'item-1' }); await op.revise('session-a', 's', 'item-1', 1, { body: 'v2' })
    expect(await op.revise('session-b', 's', 'item-1', 1, { body: 'stale' })).toEqual({ error: { code: 'COLLAB_STALE_REVISION', details: { currentRevision: 2 } } })
  }))
  it('disclose-03：创建冲突是唯一例外', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-c', { live: true })
    await start(host); const op = ops(host)
    await op.create('session-a', 's', 'a'); const before = await bytes(ledger(host, 's'))
    expect(await op.create('session-c', 's', 'c')).toEqual({ error: { code: 'COLLAB_SPACE_EXISTS' } })
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))
})
