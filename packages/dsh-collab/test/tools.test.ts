import { it, expect } from 'vitest'
import { collabTools, safeError } from '../src/tools.js'
import { CollabError } from 'collab-kernel'
it('tool-contract: exactly twenty named tools, unknown identity fields rejected before Host reads', async () => {
  let calls = 0
  const ctx: any = { tools: { register(tool: any) { tools.push(tool) } } }
  const tools: any[] = []
  collabTools(ctx, { caller: async () => { calls++; return 'a' } } as any, undefined as any)
  expect(tools).toHaveLength(20)
  expect(tools.map(x => x.name).sort()).toEqual(['collab_create_space', 'collab_invite', 'collab_join', 'collab_decline_invite', 'collab_leave', 'collab_mark_gone', 'collab_transfer_leader', 'collab_close_space', 'collab_create_item', 'collab_revise_item', 'collab_ack_item', 'collab_send_message', 'collab_set_status', 'collab_advance_request', 'collab_request_decision', 'collab_overview', 'collab_read_since', 'collab_project', 'collab_read_convention', 'collab_sessions'].sort())
  expect(tools.map(x => x.name).some((name: string) => /confirm|reset|break|execute/.test(name))).toBe(false)
  const create = tools.find(x => x.name === 'collab_create_space')
  for (const extra of [{ actor: 'fake' }, { principal: {} }, { sessionId: 'fake' }, { providerId: 'fake' }, { unexpected: true }]) {
    await expect(create.execute({ spaceId: 's', cmdId: 'c', name: 'A', ...extra }, {})).rejects.toBeDefined()
  }
  expect(calls).toBe(0)
})
it('tool-mapping: every named adapter invokes its exact method with actual caller principal', async () => {
  const tools: any[] = [], calls: any[] = []
  const service: any = new Proxy({}, { get: (_target, method) => async (...args: unknown[]) => { calls.push({ method, args }); return { ok: true } } })
  const host: any = { context: (id: string, spaceId: string, cmdId: string) => ({ principal: { kind: 'agent', channel: 'dsh-session', address: id }, spaceId, cmdId }), command: (_id: string, _space: string, _cmd: string, run: any) => run(service), read: (_id: string, _space: string, run: any) => run(service) }
  collabTools({ tools: { register(tool: any) { tools.push(tool); return () => {} } } } as any, { caller: () => 'actual-b', discover: async () => ['metadata'] } as any, () => host)
  const rows = [
    ['create_space', 'createSpace', { name: 'b' }, { name: 'b', address: 'actual-b', kind: 'agent' }],
    ['invite', 'invite', { name: 'a', recipientSessionId: 'target-a' }, { name: 'a', address: 'target-a', kind: 'agent' }],
    ['join', 'join', {}], ['decline_invite', 'declineInvite', {}], ['leave', 'leave', {}],
    ['mark_gone', 'markGone', { member: 'a' }, { member: 'a' }], ['transfer_leader', 'transferLeader', { member: 'a' }, { member: 'a' }], ['close_space', 'closeSpace', {}],
    ['create_item', 'createItem', { itemId: 'i', kind: 'request', title: 'T', body: 'B', requiredAcks: [], deciders: [], assignee: 'a' }, { itemId: 'i', kind: 'request', title: 'T', body: 'B', requiredAcks: [], deciders: [], assignee: 'a' }],
    ['revise_item', 'reviseItem', { itemId: 'i', expectedRevision: 2, changes: { title: 'T2' } }, { itemId: 'i', expectedRevision: 2, changes: { title: 'T2' } }],
    ['ack_item', 'ackItem', { itemId: 'i', revision: 2 }, { itemId: 'i', revision: 2 }],
    ['send_message', 'sendMessage', { to: 'a', body: 'B', needsReply: true }, { to: 'a', body: 'B', needsReply: true }],
    ['set_status', 'setStatus', { text: 'working' }, { text: 'working' }],
    ['advance_request', 'advanceRequest', { itemId: 'i', progress: 'done' }, { itemId: 'i', progress: 'done' }],
    ['request_decision', 'requestDecision', { itemId: 'i', options: ['yes', 'no'] }, { itemId: 'i', options: ['yes', 'no'] }],
    ['overview', 'overview', {}], ['read_since', 'readSince', { sinceSeq: 3 }, 3], ['project', 'project', {}], ['read_convention', 'readConvention', { version: '1' }, '1'],
  ] as const
  for (const [index, [suffix, method, args, input]] of rows.entries()) {
    const tool = tools.find(x => x.name === `collab_${suffix}`)
    const write = index < 15
    await tool.execute({ spaceId: 's', ...(write ? { cmdId: 'c' } : {}), ...args }, {})
    const call = calls.at(-1)
    expect(call.method).toBe(method)
    expect(call.args[0]).toMatchObject({ principal: { kind: 'agent', channel: 'dsh-session', address: 'actual-b' }, spaceId: 's' })
    expect(call.args[0].cmdId).toBe(write ? 'c' : undefined)
    expect(call.args.length).toBe(input === undefined ? 1 : 2)
    if (input !== undefined) expect(call.args[1]).toEqual(input)
  }
  expect(await tools.find(x => x.name === 'collab_sessions').execute({}, {})).toEqual(['metadata'])
  expect(calls).toHaveLength(19)
})

it('tool-no-caller: read and write bodies refuse missing execution identity before data lookup', async () => {
  const tools: any[] = []
  const access: any = { caller(exec: any) { if (!exec.agent) throw new CollabError('COLLAB_CALLER_UNAVAILABLE'); return 'a' } }
  let reads = 0
  collabTools({ tools: { register(tool: any) { tools.push(tool); return () => {} } } } as any, access, () => { reads++; return undefined })
  for (const [name, args] of [['collab_overview', { spaceId: 'secret' }], ['collab_create_space', { spaceId: 'secret', cmdId: 'c', name: 'a' }]] as const) {
    expect((await tools.find(tool => tool.name === name).execute(args, {})).error.code).toBe('COLLAB_CALLER_UNAVAILABLE')
  }
  expect(reads).toBe(0)
})

it('tool-error: native caller failures and raw lock paths never enter model data', async () => {
  const tools: any[] = []
  collabTools({ tools: { register(tool: any) { tools.push(tool); return () => {} } } } as any, { caller() { throw new Error('/private/secret/credentials') } } as any, () => undefined)
  expect(await tools.find(x => x.name === 'collab_overview').execute({ spaceId: 's' }, {})).toEqual({ error: { code: 'COLLAB_HOST_ERROR' } })
  const locked = Object.assign(new CollabError('COLLAB_STORE_LOCKED', { lockPath: '/private/data/s.lock', lock: { instanceId: 'instance', pid: 123 } }), { lock: 'RAW_SECRET', stack: 'STACK_SECRET' })
  expect(safeError(locked)).toEqual({ code: 'COLLAB_STORE_LOCKED', details: { lock: { instanceId: 'instance', pid: 123 } } })
  expect(safeError(new CollabError('COLLAB_REVISION_CONFLICT', { currentRevision: 2 }))).toEqual({ code: 'COLLAB_REVISION_CONFLICT', details: { currentRevision: 2 } })
})
