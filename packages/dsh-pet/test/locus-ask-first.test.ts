/**
 * `locus-ask-work-first-and-concise` groups 4/5/7: the question a locus child
 * sends to its locus main session (`locus_ask_parent`), the ask reference that
 * binds an answer to the Delivery being asked about (`askRef`), and the rule
 * text that makes an already-existing locus main follow the new answer order.
 *
 * Runs against the REAL dsh-collab plugin (charters) and the REAL v20 Delivery
 * repository (what is "current" is read from durable records, never a stub);
 * only the official `subagents.sendMessage` is a recording stand-in.
 * Rejections always assert `sendMessage` was not called.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { locusIdentity, locusSpaceId } from '../src/host/collab/naming.js'
import { endpointKeyOf } from '../src/host/locus/aggregate.js'
import { docChatId, docMessageId } from '../src/host/locus/doc-endpoint.js'
import { composeLocusCoordinatorBriefing } from '../src/host/locus/dsh-port.js'
import { LocusRepositoryV20, type LocusDomain } from '../src/host/locus/persistence-v20.js'
import { mainToolFailureText, replyChild } from '../src/host/collab/locus-tools.js'
import { LOCUS_ASK_PARENT_TOOL, LOCUS_REPLY_CHILD_TOOL, registerPetLocusMainTools, registerPetTools } from '../src/host/tools.js'
import { result } from './support/collab-host.js'
import { identityOf, openTodoWorld, type TestLocusRow, type TodoWorld } from './support/collab-todo.js'

const M = 'locus-main-ask'
const W = 'work-ask'
const A = { chatId: 'oc-ask-a' }
const B = { chatId: 'oc-ask-b' }
const DOC_TOKEN = 'doxcnAskFirst0123456789abcdefg'
const DOC = { chatId: docChatId(DOC_TOKEN)! }

let todo: TodoWorld | undefined
afterEach(async () => { await todo?.world.stop(); todo = undefined })

const row = (id: string, endpoint: TestLocusRow['endpoint'], child: string, state = 'active', generation = 1): TestLocusRow => ({
  id, generation, endpoint, locusMainSessionId: M, childSessionId: child, state,
})

async function ready(...rows: TestLocusRow[]) {
  todo = await openTodoWorld()
  await todo.addMain({ locusMainSessionId: M, workSessionId: W })
  for (const item of rows) todo.addLocus(item)
  return todo
}

/** Record a charter as the locus main session; `ack` lets the work session agree to it. */
async function charter(t: TodoWorld, itemId: string, entry: string | undefined, options: { ack?: boolean } = {}) {
  const created = await t.collab.actAs(M, `charter-${itemId}`, {
    op: 'createItem',
    input: { itemId, kind: 'charter', title: `title-${itemId}`, body: `body-${itemId}`, requiredAcks: ['work'], ...(entry === undefined ? {} : { ext: { pet: { entry } } }) },
  })
  expect(created.ok).toBe(true)
  if (options.ack === false) return
  const acked = result(await t.world.call(t.world.live.get(W), 'collab_ack_item', { spaceId: locusSpaceId(M), cmdId: `ack-${itemId}`, itemId, revision: 1 }))
  expect(acked.error).toBeUndefined()
}

function memoryDomain(): LocusDomain {
  const tables = new Map<string, Map<string, unknown>>()
  const table = (name: string) => {
    let map = tables.get(name)
    if (map === undefined) {
      map = new Map()
      tables.set(name, map)
    }
    return {
      get: (key: string) => map!.get(key),
      entries: () => map!.entries(),
      keys: () => map!.keys(),
      get size() { return map!.size },
      put: async (key: string, value: unknown) => { map!.set(key, value) },
      delete: async (key: string) => map!.delete(key),
    }
  }
  return {
    table,
    supportsTransaction: true,
    transaction: async (body: (tx: { put(t: string, k: string, v: unknown): void; delete(t: string, k: string): void }) => void) => {
      body({ put: (t, k, v) => { table(t).put(k, v) }, delete: (t, k) => { table(t).delete(k) } })
    },
  } as unknown as LocusDomain
}

const DAY = 24 * 60 * 60 * 1000

/** The durable Delivery repository behind the entries of a todo world; reopen it over the same domain to "restart". */
async function openDeliveries(t: TodoWorld, domain: LocusDomain = memoryDomain()) {
  for (const item of t.loci) {
    await domain.table('loci').put(item.id, {
      endpoint: item.endpoint, locusId: item.id, sessionId: item.childSessionId, state: item.state, accessMode: 'read-only',
      revision: 1, createdAt: 1, updatedAt: 1, locusMainSessionId: item.locusMainSessionId, workspaceId: 'ws',
    })
  }
  let clock = 10
  const repo = new LocusRepositoryV20(domain, { now: () => 5 })
  const correlation = (item: TestLocusRow) => ({ endpoint: item.endpoint, locusId: item.id, sessionId: item.childSessionId })
  return {
    domain,
    repo,
    reopen: () => new LocusRepositoryV20(domain, { now: () => 5 }),
    accept: (item: TestLocusRow, messageId: string) =>
      repo.acceptDelivery({ ...correlation(item), messageId, deliveryId: `d-${messageId}`, senderOpenId: 'ou_asker', text: messageId, acceptedAt: ++clock } as never),
    claim: (item: TestLocusRow) => repo.claimCurrentDelivery({ ...correlation(item), now: ++clock } as never),
    /** Make the current Delivery terminal because its deadline passed. */
    expire: (item: TestLocusRow, messageId: string) =>
      repo.expireCurrentDelivery({ ...correlation(item), deliveryId: `d-${messageId}`, now: clock + DAY / 2 } as never),
    finish: async (item: TestLocusRow, messageId: string) => {
      await repo.markDeliveryFinishing({ ...correlation(item), deliveryId: `d-${messageId}`, now: ++clock } as never)
      return repo.completeCurrentDelivery({ ...correlation(item), deliveryId: `d-${messageId}`, now: ++clock, outcome: 'reply', outboundResult: 'success' } as never)
    },
  }
}
type Deliveries = Awaited<ReturnType<typeof openDeliveries>>

/** Entry `item` has `messageId` as its current Delivery. */
async function makeCurrent(d: Deliveries, item: TestLocusRow, messageId: string) {
  await d.accept(item, messageId)
  const claimed = await d.claim(item)
  expect(claimed).toMatchObject({ changed: true, record: { messageId, status: 'current' } })
}

interface SendCall { readonly sender: any; readonly target: string; readonly content: any[] }

/** The v20 reverse lookup: one row per sessionId, the M resolved. */
const lookupOf = (t: TodoWorld, repo: LocusRepositoryV20) => ({
  findBySessionId: (id: string) => {
    const item = t.loci.find(candidate => candidate.childSessionId === id)
    return item === undefined ? undefined : {
      row: { locusId: item.id, sessionId: item.childSessionId, state: item.state, endpoint: item.endpoint },
      locusMainSessionId: item.locusMainSessionId,
      workspaceId: 'ws',
    } as never
  },
  findCurrentSerializedDelivery: (input: { locusId: string; sessionId: string }) => repo.findCurrentSerializedDelivery(input),
  listEntryEndpointsOfMain: (m: string) => t.loci.filter(item => item.locusMainSessionId === m).map(item => item.endpoint),
})

function fixture(t: TodoWorld, repo: LocusRepositoryV20, options: { collab?: unknown } = {}) {
  const sends: SendCall[] = []
  const subagents = {
    async sendMessage(sender: any, target: string, content: any[]) { sends.push({ sender, target, content }); return 'msg-1' },
  }
  const collab = (options.collab ?? t.collab) as never
  const loci = lookupOf(t, repo)
  const childTools = new Map<string, any>()
  registerPetTools({ tools: { register: (definition: any) => { childTools.set(definition.name, definition); return () => {} } } } as never, {
    repository: {} as never,
    locusChildTools: { loci, collab, subagents: () => subagents },
  } as never)
  const mainTools = new Map<string, any>()
  registerPetLocusMainTools({ tools: { register: (definition: any) => { mainTools.set(definition.name, definition); return () => {} } } } as never, {
    loci, collab, subagents: () => subagents,
  } as never)
  const call = async (tools: Map<string, any>, name: string, args: unknown, agentId: string) =>
    tools.get(name)!.execute(args, { agent: t.world.live.get(agentId) ?? { id: agentId }, signal: new AbortController().signal })
  const textOf = (send: SendCall) => send.content.map((block: any) => block.text).join('\n')
  const ask = (child: string, question = '这个功能是什么逻辑？') => call(childTools, LOCUS_ASK_PARENT_TOOL, { question }, child)
  const reply = (child: string, askRef: unknown, text = '按已确认的做。') =>
    call(mainTools, LOCUS_REPLY_CHILD_TOOL, { childSessionId: child, text, ...(askRef === undefined ? {} : { askRef }) }, M)
  return { sends, childTools, mainTools, call, textOf, ask, reply }
}

/** The ask reference quoted in a question the locus main received. */
const refIn = (text: string): string => /询问引用 askRef：(\S+)/.exec(text)?.[1] ?? '<missing>'

/** The Delivery of an entry that is current right now, as the durable store sees it. */
const currentOf = (repo: LocusRepositoryV20, item: TestLocusRow) => repo.findCurrentSerializedDelivery({ locusId: item.id, sessionId: item.childSessionId })

describe('子会话向父询问：询问消息与询问引用', () => {
  it('spec Scenario "子会话向父询问并在同一 current 上继续"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    await makeCurrent(d, a, 'om_D')
    const { sends, textOf, ask, reply, childTools } = fixture(t, d.repo)

    expect(await ask('child-a', '这个仓库的发布流程是什么？')).toEqual({ ok: true })

    expect(sends).toHaveLength(1)
    expect(sends[0]!.target).toBe(M)
    expect(sends[0]!.sender).toBe(t.world.live.get('child-a'))
    const asked = textOf(sends[0]!)
    expect(asked).toContain('这个仓库的发布流程是什么？')
    expect(asked).toContain(identityOf(A))
    expect(asked).toContain('child-a')
    // The reference is the trigger message id of the current Delivery, written by the Host.
    expect(refIn(asked)).toBe('om_D')

    expect(await reply('child-a', refIn(asked), '按 README 的发布章节走。')).toEqual({ ok: true })

    expect(sends).toHaveLength(2)
    expect(sends[1]!.target).toBe('child-a')
    expect(sends[1]!.sender).toBe(t.world.live.get(M))
    expect(textOf(sends[1]!)).toContain('按 README 的发布章节走。')
    // The ask carries no target or reference argument: a model cannot pick it.
    expect(Object.keys(childTools.get(LOCUS_ASK_PARENT_TOOL)!.parameters.properties)).toEqual(['question'])
    // Same Host-bound target: D is still the one current Delivery and no other was created.
    expect(currentOf(d.repo, a)).toMatchObject({ messageId: 'om_D', status: 'current' })
    expect(d.repo.listDeliveries()).toHaveLength(1)
  })

  it('spec Scenario "询问附带已确认结论"', async () => {
    const a = row('rec-a', A, 'child-a')
    const b = row('rec-b', B, 'child-b')
    const t = await ready(a, b)
    const d = await openDeliveries(t)
    await charter(t, 'charter-x', undefined)
    await charter(t, 'charter-y', identityOf(A))
    await charter(t, 'charter-p', undefined, { ack: false })
    expect((await t.collab.actAs(M, 'msg-private', { op: 'sendMessage', input: { to: 'work', body: '这是一条私下消息', needsReply: false, notify: false } })).ok).toBe(true)
    const { sends, textOf, ask } = fixture(t, d.repo)

    expect(await ask('child-b')).toEqual({ ok: true })

    const asked = textOf(sends[0]!)
    expect(asked).toContain('body-charter-x')
    expect(asked).toMatch(/工作空间级[\s\S]*title-charter-x/)
    expect(asked).toContain('body-charter-y')
    expect(asked).toContain(identityOf(A))
    expect(asked).not.toContain('charter-p')
    expect(asked).not.toContain('私下消息')
  })

  it('spec Scenario "同一工作会话下的入口共享结论"', async () => {
    const a = row('rec-a', A, 'child-a')
    const b = row('rec-b', B, 'child-b')
    const t = await ready(a, b)
    const d = await openDeliveries(t)
    await charter(t, 'charter-y', identityOf(A))
    const { sends, textOf, ask } = fixture(t, d.repo)

    expect(await ask('child-b')).toEqual({ ok: true })

    const asked = textOf(sends[0]!)
    expect(asked).toContain('body-charter-y')
    // The conclusion is attributed to entry A, not presented as B's own.
    expect(asked).toMatch(new RegExp(`入口 ${identityOf(A).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*title-charter-y`))
  })

  it('spec Scenario "协作空间不可读时仍投递询问"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    const unreadable = { currentHandle: () => undefined, isReady: async () => false, actAs: async () => ({ ok: false, code: 'COLLAB_UNAVAILABLE' }) }
    const { sends, textOf, ask } = fixture(t, d.repo, { collab: unreadable })

    expect(await ask('child-a')).toEqual({ ok: true })

    expect(sends).toHaveLength(1)
    expect(textOf(sends[0]!)).toContain('已确认结论暂不可读')
  })

  it('已确认结论过长时限长并标明截断', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    for (let index = 0; index < 40; index++) {
      const id = `charter-long-${index}`
      expect((await t.collab.actAs(M, `long-${index}`, { op: 'createItem', input: { itemId: id, kind: 'charter', title: `t-${index}`, body: `长结论-${index}-`.repeat(150), requiredAcks: ['work'] } })).ok).toBe(true)
      expect(result(await t.world.call(t.world.live.get(W), 'collab_ack_item', { spaceId: locusSpaceId(M), cmdId: `ack-${id}`, itemId: id, revision: 1 })).error).toBeUndefined()
    }
    const { sends, textOf, ask } = fixture(t, d.repo)

    expect(await ask('child-a')).toEqual({ ok: true })

    const asked = textOf(sends[0]!)
    expect(asked).toContain('已截断')
    expect(asked.length).toBeLessThan(12_000)
  })

  it('spec Scenario "询问消息带答复义务"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    const { sends, textOf, ask } = fixture(t, d.repo)

    expect(await ask('child-a')).toEqual({ ok: true })

    expect(textOf(sends[0]!)).toContain('回合结束前必须以 `locus_reply_child` 给出答案、无记录或已转问之一')
  })

  it('spec Scenario "已有 locus 主会话收到新流程"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    const { sends, textOf, ask } = fixture(t, d.repo)

    expect(await ask('child-a')).toEqual({ ok: true })

    const asked = textOf(sends[0]!)
    // The order, the askRef usage, the disclosure scope and the one-line status all arrive with every question.
    for (const phrase of ['locus_work_history', '最近 3 轮', '关键词', '一行状态', '`askRef`', '询问引用', '业务口径']) {
      expect(asked, phrase).toContain(phrase)
    }
  })

  it('spec Scenario "解绑后不再引用原工作会话"', async () => {
    const g = row('rec-g', A, 'child-g', 'stopped')
    const t = await ready(g)
    const d = await openDeliveries(t)
    const { sends, ask } = fixture(t, d.repo)

    const asked = await ask('child-g')

    expect(asked).toMatchObject({ ok: false, reason: 'caller-unavailable' })
    expect(sends).toEqual([])
  })

  it('旧代子会话仍不能询问', async () => {
    const t = await ready(row('rec-a-g1', A, 'child-old', 'retired', 1), row('rec-a-g2', A, 'child-new', 'active', 2))
    const d = await openDeliveries(t)
    const { sends, ask } = fixture(t, d.repo)

    expect(await ask('child-old')).toMatchObject({ ok: false })
    expect(sends).toEqual([])
  })
})

describe('locus_reply_child 的 askRef 核对', () => {
  it('spec Scenario "Delivery 已换代后的答复被拒"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    await makeCurrent(d, a, 'om_D')
    await d.accept(a, 'om_E')
    const { sends, textOf, ask, reply } = fixture(t, d.repo)
    expect(await ask('child-a')).toEqual({ ok: true })
    const refD = refIn(textOf(sends[0]!))
    expect(refD).toBe('om_D')
    sends.length = 0
    expect(await d.expire(a, 'om_D')).toMatchObject({ changed: true })
    expect(await d.claim(a)).toMatchObject({ changed: true, record: { messageId: 'om_E' } })

    const late = await reply('child-a', refD)

    expect(late).toEqual({ ok: false, reason: 'ask-expired' })
    expect(mainToolFailureText('ask-expired')).toContain('询问已过期')
    expect(sends).toHaveLength(0)
    expect(currentOf(d.repo, a)).toMatchObject({ messageId: 'om_E', status: 'current' })
  })

  it('spec Scenario "新询问之后旧询问的答复仍被拒"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    await makeCurrent(d, a, 'om_D')
    await d.accept(a, 'om_E')
    const { sends, textOf, ask, reply } = fixture(t, d.repo)
    expect(await ask('child-a', '问题 D')).toEqual({ ok: true })
    const refD = refIn(textOf(sends[0]!))
    expect(await reply('child-a', refD, '已转问工作会话')).toEqual({ ok: true })
    await d.expire(a, 'om_D')
    await d.claim(a)
    expect(await ask('child-a', '问题 E')).toEqual({ ok: true })
    const refE = refIn(textOf(sends[2]!))
    expect(refE).toBe('om_E')
    sends.length = 0

    // The work session answers D only now.
    const lateD = await reply('child-a', refD, '工作会话对 D 的答案')

    expect(lateD).toEqual({ ok: false, reason: 'ask-expired' })
    expect(sends).toHaveLength(0)
    expect(currentOf(d.repo, a)).toMatchObject({ messageId: 'om_E', status: 'current' })
    // Answering E with E's own reference is delivered normally.
    expect(await reply('child-a', refE, 'E 的答案')).toEqual({ ok: true })
    expect(sends).toHaveLength(1)
  })

  it('spec Scenario "已转问与最终答复都能送达"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    await makeCurrent(d, a, 'om_D')
    const { sends, textOf, ask, reply } = fixture(t, d.repo)
    expect(await ask('child-a')).toEqual({ ok: true })
    const refD = refIn(textOf(sends[0]!))
    sends.length = 0

    expect(await reply('child-a', refD, '已转问工作会话')).toEqual({ ok: true })
    expect(await reply('child-a', refD, '工作会话的答案')).toEqual({ ok: true })

    expect(sends).toHaveLength(2)
  })

  it('spec Scenario "无 current 时的询问在 E 出现后被拒"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    const { sends, textOf, ask, reply } = fixture(t, d.repo)
    expect(await ask('child-a')).toEqual({ ok: true })
    expect(refIn(textOf(sends[0]!))).toBe('none')
    sends.length = 0
    await makeCurrent(d, a, 'om_E')

    const late = await reply('child-a', 'none')

    expect(late).toEqual({ ok: false, reason: 'ask-expired' })
    expect(sends).toHaveLength(0)
  })

  it('spec Scenario "current 结束后旧答复被拒"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    await makeCurrent(d, a, 'om_D')
    const { sends, textOf, ask, reply } = fixture(t, d.repo)
    expect(await ask('child-a')).toEqual({ ok: true })
    const refD = refIn(textOf(sends[0]!))
    sends.length = 0
    expect(await d.finish(a, 'om_D')).toMatchObject({ changed: true })
    expect(currentOf(d.repo, a)).toBeUndefined()

    const late = await reply('child-a', refD)

    expect(late).toEqual({ ok: false, reason: 'ask-expired' })
    expect(sends).toHaveLength(0)
  })

  it('spec Scenario "缺少询问引用"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    await makeCurrent(d, a, 'om_D')
    const { sends, reply, mainTools } = fixture(t, d.repo)

    // Through the tool: the required parameter is enforced by the tool runtime's own argument check.
    await expect(reply('child-a', undefined)).rejects.toThrow(/askRef/)
    await expect(reply('child-a', 42)).rejects.toThrow(/askRef/)
    // Values that pass the type check but are not a reference are refused by the Host logic.
    expect(await reply('child-a', '')).toEqual({ ok: false, reason: 'invalid-ask-ref' })
    expect(await reply('child-a', 'om D')).toEqual({ ok: false, reason: 'invalid-ask-ref' })
    // A caller that bypasses the schema (an embedded caller of the Host function) is refused the same way.
    const direct = await replyChild(t.world.live.get(M), M, { childSessionId: 'child-a', text: 'x' } as never, new AbortController().signal, {
      loci: lookupOf(t, d.repo), subagents: () => ({ sendMessage: async () => { sends.push({ sender: undefined, target: '', content: [] }) } }),
    } as never)
    expect(direct).toEqual({ ok: false, reason: 'invalid-ask-ref' })

    expect(sends).toHaveLength(0)
    const tool = mainTools.get(LOCUS_REPLY_CHILD_TOOL)!
    expect(tool.parameters.properties.askRef).toMatchObject({ type: 'string' })
    expect(tool.parameters.required).toContain('askRef')
    // Both the tool description and the failure text send an old session to the reference in the question.
    expect(tool.description).toContain('询问引用 askRef')
    expect(mainToolFailureText('invalid-ask-ref')).toContain('询问引用')
  })

  it('spec Scenario "解绑重绑后旧答复被拒"', async () => {
    const g0 = row('rec-g-1', A, 'child-c0', 'active', 1)
    const t = await ready(g0)
    const d = await openDeliveries(t)
    await makeCurrent(d, g0, 'om_D')
    const { sends, textOf, ask, reply } = fixture(t, d.repo)
    expect(await ask('child-c0')).toEqual({ ok: true })
    const refD = refIn(textOf(sends[0]!))
    sends.length = 0
    // /unbind then /bind: the entry now reserves a new child.
    t.updateLocus('rec-g-1', { state: 'retired' })
    t.addLocus(row('rec-g-2', A, 'child-c1', 'active', 2))

    const late = await reply('child-c0', refD)

    expect(late).toEqual({ ok: false, reason: 'not-owned' })
    expect(sends).toHaveLength(0)
  })

  it('spec Scenario "Host 重启后仍可答复当前询问"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    await makeCurrent(d, a, 'om_D')
    const before = fixture(t, d.repo)
    expect(await before.ask('child-a')).toEqual({ ok: true })
    const refD = refIn(before.textOf(before.sends[0]!))

    // Host restart: every in-memory object is rebuilt over the same durable domain.
    const restarted = fixture(t, d.reopen())

    expect(await restarted.reply('child-a', refD, '重启后的答复')).toEqual({ ok: true })
    expect(restarted.sends).toHaveLength(1)
  })

  describe('askRef 边界（review round 6 S1）', () => {
    it('none→none：无 current 时的询问与答复照常送达且不创建 Delivery', async () => {
      const a = row('rec-a', A, 'child-a')
      const t = await ready(a)
      const d = await openDeliveries(t)
      const { sends, textOf, ask, reply } = fixture(t, d.repo)
      expect(await ask('child-a')).toEqual({ ok: true })
      const ref = refIn(textOf(sends[0]!))
      expect(ref).toBe('none')
      sends.length = 0

      expect(await reply('child-a', ref)).toEqual({ ok: true })

      expect(sends).toHaveLength(1)
      expect(d.repo.listDeliveries()).toHaveLength(0)
    })

    it('同一 Delivery 连续问两次，两个答复都能送达', async () => {
      const a = row('rec-a', A, 'child-a')
      const t = await ready(a)
      const d = await openDeliveries(t)
      await makeCurrent(d, a, 'om_D')
      const { sends, textOf, ask, reply } = fixture(t, d.repo)
      expect(await ask('child-a', '第一问')).toEqual({ ok: true })
      expect(await ask('child-a', '第二问')).toEqual({ ok: true })
      const first = refIn(textOf(sends[0]!))
      const second = refIn(textOf(sends[1]!))
      expect(second).toBe(first)
      sends.length = 0

      expect(await reply('child-a', first, '第一问的答复')).toEqual({ ok: true })
      expect(await reply('child-a', second, '第二问的答复')).toEqual({ ok: true })

      expect(sends).toHaveLength(2)
    })

    it('文档评论：完整的 doc 触发 id 原样通过，另一个 replyId 被拒', async () => {
      const doc = row('rec-doc', DOC, 'child-doc')
      const t = await ready(doc)
      const d = await openDeliveries(t)
      const trigger = docMessageId({ token: DOC_TOKEN, commentId: '7001', replyId: '8001' })!
      await makeCurrent(d, doc, trigger)
      const { sends, textOf, ask, reply } = fixture(t, d.repo)
      expect(await ask('child-doc')).toEqual({ ok: true })
      const ref = refIn(textOf(sends[0]!))
      expect(ref).toBe(trigger)
      sends.length = 0

      expect(await reply('child-doc', ref)).toEqual({ ok: true })
      expect(sends).toHaveLength(1)
      const otherReply = docMessageId({ token: DOC_TOKEN, commentId: '7001', replyId: '8002' })!
      expect(await reply('child-doc', otherReply)).toEqual({ ok: false, reason: 'ask-expired' })
      expect(sends).toHaveLength(1)
    })

    it('旧 M 缺 askRef 被拒后，按错误文案里的询问引用补参重试成功', async () => {
      const a = row('rec-a', A, 'child-a')
      const t = await ready(a)
      const d = await openDeliveries(t)
      await makeCurrent(d, a, 'om_D')
      const { sends, textOf, ask, reply, mainTools } = fixture(t, d.repo)
      expect(await ask('child-a')).toEqual({ ok: true })
      const ref = refIn(textOf(sends[0]!))
      sends.length = 0

      // The old session omits the new required argument: refused, nothing delivered.
      await expect(reply('child-a', undefined)).rejects.toThrow(/askRef/)
      expect(sends).toHaveLength(0)
      expect(mainTools.get(LOCUS_REPLY_CHILD_TOOL)!.description).toContain('询问引用 askRef')
      expect(mainToolFailureText('invalid-ask-ref')).toMatch(/询问引用.*askRef|askRef.*询问引用/)
      // It retries with the reference quoted in the question.
      expect(await reply('child-a', ref)).toEqual({ ok: true })
      expect(sends).toHaveLength(1)
    })
  })

  it('spec Scenario "询问已投递但始终没有答复"（Host 侧：Delivery 到期后不发正文，也不被答复复活）', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    await makeCurrent(d, a, 'om_D')
    const { sends, ask } = fixture(t, d.repo)
    expect(await ask('child-a')).toEqual({ ok: true })
    sends.length = 0

    expect(await d.expire(a, 'om_D')).toMatchObject({ changed: true, record: { status: 'expired' } })

    // No business body went out (the Host sent nothing), the queue advances, and D is not current any more.
    expect(sends).toHaveLength(0)
    expect(d.repo.getDelivery('d-om_D')).toMatchObject({ status: 'expired' })
    expect(currentOf(d.repo, a)).toBeUndefined()
  })

  it('spec Scenario "父答复在 Delivery 过期后才到达"', async () => {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    await makeCurrent(d, a, 'om_D')
    await d.accept(a, 'om_E')
    const { sends, textOf, ask, reply } = fixture(t, d.repo)
    expect(await ask('child-a')).toEqual({ ok: true })
    const refD = refIn(textOf(sends[0]!))
    sends.length = 0
    await d.expire(a, 'om_D')
    await d.claim(a)

    const late = await reply('child-a', refD)

    expect(late).toEqual({ ok: false, reason: 'ask-expired' })
    expect(sends).toHaveLength(0)
    expect(d.repo.getDelivery('d-om_D')).toMatchObject({ status: 'expired' })
    expect(currentOf(d.repo, a)).toMatchObject({ messageId: 'om_E', status: 'current' })
  })
})

describe('主会话找答案顺序的规则文本', () => {
  const briefing = () => composeLocusCoordinatorBriefing({ label: 'Locus 协调会话', workSessionId: W, workspaceId: 'ws', workspacePath: '/tmp/ws' })

  /** Both surfaces that carry the rules: every question message and the opening briefing. */
  async function surfaces() {
    const a = row('rec-a', A, 'child-a')
    const t = await ready(a)
    const d = await openDeliveries(t)
    const { sends, textOf, ask } = fixture(t, d.repo)
    expect(await ask('child-a')).toEqual({ ok: true })
    return { question: textOf(sends[0]!), briefing: briefing() }
  }

  it('spec Scenario "工作会话忙时只读记录不打扰"', async () => {
    const { question, briefing: opening } = await surfaces()
    for (const text of [question, opening]) {
      expect(text).toMatch(/状态为"忙"或"unknown"[\s\S]*不要向工作会话发任何协作消息/)
      expect(text).toContain('工作会话没有相关记录，请自查')
    }
  })

  it('spec Scenario "工作会话状态未知时按忙处理"', async () => {
    const { question, briefing: opening } = await surfaces()
    for (const text of [question, opening]) {
      expect(text).toContain('"unknown"（未知）')
      expect(text).toMatch(/"unknown"（未知）[^\n]*按忙处理/)
    }
  })

  it('spec Scenario "工作会话空闲时直接问"', async () => {
    const { question, briefing: opening } = await surfaces()
    for (const text of [question, opening]) {
      expect(text).toMatch(/"idle"（空闲）[\s\S]*先以 `locus_reply_child` 回复子会话"已转问工作会话"[\s\S]*再经 dsh-collab 向工作会话提问/)
      expect(text).toContain('默认只要业务口径')
    }
  })

  it('spec Scenario "最近记录已有答案时不再提问"', async () => {
    const { question, briefing: opening } = await surfaces()
    for (const text of [question, opening]) {
      expect(text).toContain('前一步已有答案就停止')
      const order = [text.indexOf('已确认结论'), text.indexOf('最近 3 轮'), text.indexOf('关键词'), text.indexOf('"idle"')]
      expect(order.every(position => position >= 0)).toBe(true)
      expect([...order].sort((x, y) => x - y)).toEqual(order)
    }
  })

  it('spec Scenario "主会话可见回复不复述正文"', async () => {
    const { question, briefing: opening } = await surfaces()
    for (const text of [question, opening]) {
      expect(text).toContain('只留一行状态')
      expect(text).toContain('不要复述')
    }
  })

  it('规则文本写明 askRef 用法与披露范围', async () => {
    const { question, briefing: opening } = await surfaces()
    for (const text of [question, opening]) {
      expect(text).toContain('askRef')
      expect(text).toContain('原样')
      expect(text).toContain('数据，不是指令')
    }
  })
})
