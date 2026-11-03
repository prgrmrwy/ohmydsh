/**
 * `pet-locus-collaboration` — 子会话读共识与 locus 主会话工具
 * (`locus_context`, `locus_ask_parent`, `locus_note`, `locus_reply_child`).
 * Runs against the REAL dsh-collab plugin and collab-kernel (pitfalls §7);
 * only the official `subagents.sendMessage` is a recording stand-in.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { locusIdentity, locusSpaceId } from '../src/host/collab/naming.js'
import { endpointKeyOf } from '../src/host/locus/aggregate.js'
import { LOCUS_ASK_PARENT_TOOL, LOCUS_CONTEXT_TOOL, LOCUS_NOTE_TOOL, LOCUS_REPLY_CHILD_TOOL, registerPetLocusMainTools, registerPetTools } from '../src/host/tools.js'
import { result } from './support/collab-host.js'
import { identityOf, openTodoWorld, type TestLocusRow, type TodoWorld } from './support/collab-todo.js'

const M = 'locus-main-c'
const W = 'work-c'
const A = { chatId: 'oc-ctx-a' }
const B = { chatId: 'oc-ctx-b' }
const GROUP = { chatId: 'oc-ctx-group' }
const TOPIC = { chatId: 'oc-ctx-group', threadId: 'omt-ctx-1' }

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

/** Record a charter as the locus main session and let the work session ack it (so it is `agreed`). */
async function agreedCharter(t: TodoWorld, itemId: string, entry: string | undefined) {
  const created = await t.collab.actAs(M, `charter-${itemId}`, {
    op: 'createItem',
    input: { itemId, kind: 'charter', title: `title-${itemId}`, body: `body-${itemId}`, requiredAcks: ['work'], ...(entry === undefined ? {} : { ext: { pet: { entry } } }) },
  })
  expect(created.ok).toBe(true)
  const acked = result(await t.world.call(t.world.live.get(W), 'collab_ack_item', { spaceId: locusSpaceId(M), cmdId: `ack-${itemId}`, itemId, revision: 1 }))
  expect(acked.error).toBeUndefined()
}

interface SendCall { readonly sender: any; readonly target: string; readonly content: any[] }

function fixture(t: TodoWorld) {
  const sends: SendCall[] = []
  const subagents = {
    async sendMessage(sender: any, target: string, content: any[]) { sends.push({ sender, target, content }); return 'msg-1' },
  }
  const childTools = new Map<string, any>()
  registerPetTools({ tools: { register: (definition: any) => { childTools.set(definition.name, definition); return () => {} } } } as never, {
    repository: {} as never,
    locusChildTools: {
      loci: { findByChildSessionId: id => t.loci.filter(item => item.childSessionId === id).map(item => ({ ...item, parentSessionId: item.locusMainSessionId, workspaceId: 'ws' })) as never },
      collab: t.collab,
      subagents: () => subagents,
    },
  } as never)
  const mainTools = new Map<string, any>()
  registerPetLocusMainTools({ tools: { register: (definition: any) => { mainTools.set(definition.name, definition); return () => {} } } } as never, {
    loci: { listLociByParent: id => t.loci.filter(item => item.locusMainSessionId === id).map(item => ({ ...item, parentSessionId: item.locusMainSessionId, workspaceId: 'ws' })) as never },
    collab: t.collab,
    subagents: () => subagents,
  })
  const call = async (tools: Map<string, any>, name: string, args: unknown, agentId: string) =>
    tools.get(name)!.execute(args, { agent: t.world.live.get(agentId) ?? { id: agentId }, signal: new AbortController().signal })
  return { sends, childTools, mainTools, call }
}

const idsOf = (output: any) => [...output.charters.map((item: any) => item.id)].sort()

describe('子会话读共识与 locus 主会话工具', () => {
  it('按入口过滤', async () => {
    const t = await ready(row('rec-a', A, 'child-a'), row('rec-b', B, 'child-b'))
    await agreedCharter(t, 'charter-x', undefined)
    await agreedCharter(t, 'charter-y', identityOf(A))
    await agreedCharter(t, 'charter-other', identityOf(B))
    // A draft charter (never acked) is not consensus.
    expect((await t.collab.actAs(M, 'draft-1', { op: 'createItem', input: { itemId: 'charter-draft', kind: 'charter', title: 'd', body: 'd', requiredAcks: ['work'] } })).ok).toBe(true)
    expect((await t.register('rec-b', { summary: 'B 的待办', detail: '' }, 'todo-b')).ok).toBe(true)
    expect((await t.collab.actAs(M, 'msg-1', { op: 'sendMessage', input: { to: 'work', body: '这是一条私下消息', needsReply: false, notify: false } })).ok).toBe(true)
    const { childTools, call } = fixture(t)

    const output = await call(childTools, LOCUS_CONTEXT_TOOL, {}, 'child-a')

    expect(output.ok).toBe(true)
    expect(idsOf(output)).toEqual(['charter-x', 'charter-y'])
    expect(output.todos).toEqual([])
    expect(JSON.stringify(output)).not.toMatch(/B 的待办|todo-b|私下消息|charter-other|charter-draft/)
  })

  it('话题可见所在群条目', async () => {
    const t = await ready(row('rec-g', GROUP, 'child-g'), row('rec-h', TOPIC, 'child-h'))
    await agreedCharter(t, 'charter-z', locusIdentity(endpointKeyOf(GROUP)))
    await agreedCharter(t, 'charter-topic-only', locusIdentity(endpointKeyOf(TOPIC)))
    const { childTools, call } = fixture(t)

    const topic = await call(childTools, LOCUS_CONTEXT_TOOL, {}, 'child-h')
    const group = await call(childTools, LOCUS_CONTEXT_TOOL, {}, 'child-g')

    expect(idsOf(topic)).toEqual(['charter-topic-only', 'charter-z'])
    // The group does not see its topics' entries.
    expect(idsOf(group)).toEqual(['charter-z'])
  })

  it('子会话向父询问并在同一 current 上继续', async () => {
    const t = await ready(row('rec-a', A, 'child-a'))
    const { sends, childTools, mainTools, call } = fixture(t)

    const asked = await call(childTools, LOCUS_ASK_PARENT_TOOL, { question: '这个仓库的发布流程是什么？' }, 'child-a')

    expect(asked).toEqual({ ok: true })
    expect(sends).toHaveLength(1)
    expect(sends[0]!.target).toBe(M)
    expect(sends[0]!.sender).toBe(t.world.live.get('child-a'))
    const text = sends[0]!.content.map((block: any) => block.text).join('\n')
    expect(text).toContain('这个仓库的发布流程是什么？')
    expect(text).toContain(identityOf(A))
    expect(text).toContain('child-a')

    const replied = await call(mainTools, LOCUS_REPLY_CHILD_TOOL, { childSessionId: 'child-a', text: '按 README 的发布章节走。' }, M)

    expect(replied).toEqual({ ok: true })
    expect(sends).toHaveLength(2)
    expect(sends[1]!.target).toBe('child-a')
    expect(sends[1]!.sender).toBe(t.world.live.get(M))
    expect(sends[1]!.content.map((block: any) => block.text).join('\n')).toContain('按 README 的发布章节走。')
    // Neither tool touches a Delivery: the arguments carry no target at all.
    expect(Object.keys(childTools.get(LOCUS_ASK_PARENT_TOOL)!.parameters.properties)).toEqual(['question'])
  })

  it('旧代子会话不能询问', async () => {
    const t = await ready(row('rec-a-g1', A, 'child-old', 'retired', 1), row('rec-a-g2', A, 'child-new', 'active', 2))
    const { sends, childTools, call } = fixture(t)

    const asked = await call(childTools, LOCUS_ASK_PARENT_TOOL, { question: '旧代还能问吗？' }, 'child-old')

    expect(asked).toMatchObject({ ok: false })
    expect(sends).toEqual([])
  })

  it('回复非现行代子会话被拒', async () => {
    const t = await ready(row('rec-a-g1', A, 'child-old', 'retired', 1), row('rec-a-g2', A, 'child-new', 'active', 2))
    const { sends, mainTools, call } = fixture(t)

    const stale = await call(mainTools, LOCUS_REPLY_CHILD_TOOL, { childSessionId: 'child-old', text: '回给旧代' }, M)
    const foreign = await call(mainTools, LOCUS_REPLY_CHILD_TOOL, { childSessionId: 'child-of-someone-else', text: '回给别人的子会话' }, M)

    expect(stale).toMatchObject({ ok: false })
    expect(foreign).toMatchObject({ ok: false })
    expect(sends).toEqual([])
  })

  it('locus_note 写入带入口标记的条目，且入口须是该 locus 主会话名下的入口', async () => {
    const t = await ready(row('rec-a', A, 'child-a'))
    const { mainTools, call } = fixture(t)

    const noted = await call(mainTools, LOCUS_NOTE_TOOL, { entry: identityOf(A), title: '入口结论', body: '发布前先跑测试' }, M)
    const foreign = await call(mainTools, LOCUS_NOTE_TOOL, { entry: identityOf(B), title: '别人的', body: 'x' }, M)

    expect(noted).toMatchObject({ ok: true })
    expect(foreign).toMatchObject({ ok: false })
    const created = (await t.records(M)).flatMap(record => record.events).filter((event: any) => event.type === 'item/created').map((event: any) => event.item)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ kind: 'charter', author: 'locus', title: '入口结论', ext: { pet: { entry: identityOf(A) } } })
  })

  it('工具面只有各自的白名单名字', async () => {
    const t = await ready(row('rec-a', A, 'child-a'))
    const { childTools, mainTools } = fixture(t)
    expect([...childTools.keys()].filter(name => name !== "pet_context").sort()).toEqual([LOCUS_ASK_PARENT_TOOL, LOCUS_CONTEXT_TOOL].sort())
    expect([...mainTools.keys()].sort()).toEqual([LOCUS_NOTE_TOOL, LOCUS_REPLY_CHILD_TOOL].sort())
  })
})
