/**
 * Behaviour tests for the v20 locus presentation model (pet-locus-isomorphic-entries D10).
 * Real view snapshots, not source-string checks.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCUS_FILTER,
  ENTRY_BUCKET_OPTIONS,
  LOCUS_ACCESS_LABELS,
  LOCUS_ARCHIVED_W_NOTE,
  LOCUS_DEFAULT_QA_MISSING_NOTE,
  LOCUS_FULL_ACCESS_NOTE,
  LOCUS_INVALID_NOTE,
  LOCUS_STATE_LABELS,
  LOCUS_STOPPED_NOTE,
  LOCUS_WRITE_DISABLED_REASON,
  SHOW_ALL_LOCUS_FILTER,
  accessBlock,
  applyLocusFilter,
  applyQuery,
  archivedWorkNote,
  assignHandleCodes,
  childJumpBlock,
  collectHandleCodes,
  countLocusFilterOptions,
  emptyListText,
  endpointHandleId,
  endpointHandleLabel,
  entryDisplayName,
  entryFeishuTarget,
  entryStateFilterLabel,
  entryStateNote,
  fullAccessBlock,
  groupByEntry,
  handleCode,
  handleLabel,
  locusStateLabel,
  locusStateTone,
  rebindBlock,
  sessionJumpBlock,
  summarizeLocusView,
} from '../src/client/locus-view.js'
import { chatView, entryView, snapshotV20, workView } from './support/mgmt-snapshot.js'

const chatLink = (chatId: string) => `https://applink.feishu.cn/client/chat/open?openChatId=${chatId}`

describe('spec Requirement "管理面按工作会话分组且每个入口一行"', () => {
  it('spec Scenario "同一工作会话的多个群只出现一次 W"', () => {
    const snapshot = snapshotV20([workView([
      chatView(entryView({ chatId: 'oc_A' })),
      chatView(entryView({ chatId: 'doc:docx:D' })),
    ])])
    const view = applyLocusFilter(snapshot)
    expect(view.works).toHaveLength(1)
    expect(view.works[0]?.chats.map(chat => chat.chat.group.endpoint.chatId)).toEqual(['oc_A', 'doc:docx:D'])
    expect(new Set(view.works[0]?.chats.map(chat => chat.chat.locusMain.sessionId)).size).toBe(1)
  })

  it('spec Scenario "话题按 chatId 嵌套在群行之下"', () => {
    const snapshot = snapshotV20([workView([
      chatView(entryView({ chatId: 'oc_A' }), [entryView({ chatId: 'oc_A', threadId: 'omt_1' }), entryView({ chatId: 'oc_A', threadId: 'omt_2' })]),
      chatView(entryView({ chatId: 'oc_B' }), [entryView({ chatId: 'oc_B', threadId: 'omt_3' })]),
    ])])
    const chats = applyLocusFilter(snapshot).works[0]!.chats
    expect(chats.map(chat => [chat.chat.group.endpoint.chatId, chat.topics.map(topic => topic.endpoint.threadId)])).toEqual([
      ['oc_A', ['omt_1', 'omt_2']],
      ['oc_B', ['omt_3']],
    ])
    for (const chat of chats) for (const topic of chat.topics) expect(topic.endpoint.chatId).toBe(chat.chat.group.endpoint.chatId)
  })

  it('spec Scenario "原地重建后仍是一行"', () => {
    const rebuilt = entryView({ chatId: 'oc_A', state: 'not-created', revision: 4 })
    const view = applyLocusFilter(snapshotV20([workView([chatView(rebuilt)])]))
    expect(summarizeLocusView(view)).toEqual({ entries: 1, chats: 1, works: 1 })
    expect(JSON.stringify(view)).not.toMatch(/历史|generation"?:\s*\d|代/)
  })

  it('spec Scenario "访问模式以单值呈现"', () => {
    expect(LOCUS_ACCESS_LABELS['read-only']).toBe('只读')
    expect(LOCUS_ACCESS_LABELS['danger-full-access']).toBe('完全访问')
    expect(LOCUS_FULL_ACCESS_NOTE).toContain('整机无边界、入口成员共享')
    expect(Object.keys(LOCUS_ACCESS_LABELS)).toHaveLength(2)
  })
})

describe('spec Requirement "管理面按工作会话与入口状态筛选，条件由筛选控件自述"', () => {
  it('W 已归档的组默认隐藏，勾选「已归档」后显示并提示可改绑', () => {
    const work = { availability: 'archived' as const }
    const chat = chatView(entryView({ chatId: 'oc_A' }))
    const snapshot = snapshotV20([workView([chat], work)])
    expect(applyLocusFilter(snapshot).works).toEqual([])
    const view = applyLocusFilter(snapshot, { buckets: ['serving', 'archived'] })
    expect(view.works).toHaveLength(1)
    expect(archivedWorkNote(view.works[0]!.work)).toBe(LOCUS_ARCHIVED_W_NOTE)
    expect(rebindBlock(chat, view.works[0]!.work)).toBeUndefined()
  })

  it('offers exactly three flat buckets: 在服务 on, 已停止 / 已失效 and 已归档 off', () => {
    expect(ENTRY_BUCKET_OPTIONS.map(option => [option.id, option.label])).toEqual([
      ['serving', '在服务'], ['down', '已停止 / 已失效'], ['archived', '已归档'],
    ])
    expect(DEFAULT_LOCUS_FILTER.buckets).toEqual(['serving'])
    expect(SHOW_ALL_LOCUS_FILTER.buckets).toEqual(['serving', 'down', 'archived'])
  })

  it('buckets an archived W entry only under 已归档, whatever its state; counts add up to the total', () => {
    const snapshot = snapshotV20([
      workView([chatView(entryView({ chatId: 'oc_A' }), [entryView({ chatId: 'oc_A', threadId: 'omt_1', state: 'stopped' })])]),
      workView([chatView(entryView({ chatId: 'oc_B' }), [entryView({ chatId: 'oc_B', threadId: 'omt_2', state: 'invalid' })])],
        { sessionId: 'session-w-archived', availability: 'archived' }),
    ])
    const counts = countLocusFilterOptions(snapshot)
    expect(Object.fromEntries(counts)).toEqual({ serving: 1, down: 1, archived: 2 })
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(4)
    const archivedOnly = applyLocusFilter(snapshot, { buckets: ['archived'] })
    expect(archivedOnly.works.map(work => work.work.sessionId)).toEqual(['session-w-archived'])
    expect(archivedOnly.works[0]!.chats[0]!.topics.map(topic => topic.state)).toEqual(['invalid'])
    // 已停止 / 已失效 alone does not reach into an archived W.
    expect(applyLocusFilter(snapshot, { buckets: ['down'] }).works.map(work => work.work.sessionId))
      .toEqual(['session-906220d3-ecee-41d0-9320-f425f17edefe'])
  })

  it('always shows an unrecognised state as 未知状态, under any filter', () => {
    const snapshot = snapshotV20([workView([chatView({ ...entryView({ chatId: 'oc_A' }), state: 'retired' as never })])])
    for (const buckets of [[], ['serving'], ['down'], ['archived']] as const) {
      expect(applyLocusFilter(snapshot, { buckets }).works, buckets.join()).toHaveLength(1)
    }
    expect(locusStateLabel('retired')).toBe('未知状态')
    expect(ENTRY_BUCKET_OPTIONS.map(option => option.label)).not.toContain('未知状态')
  })

  it('reads the collapsed label from the ticked buckets', () => {
    expect(entryStateFilterLabel({ buckets: ['serving'] })).toBe('在服务')
    expect(entryStateFilterLabel({ buckets: ['serving', 'archived'] })).toBe('在服务、已归档')
    expect(entryStateFilterLabel({ buckets: ['serving', 'down', 'archived'] })).toBe('全部')
    expect(entryStateFilterLabel({ buckets: [] })).toBe('无')
  })

  it('spec Scenario "停止已归档 W 的群行后被默认隐藏"', () => {
    const snapshot = snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', state: 'stopped' }))], { availability: 'archived' })])
    expect(applyLocusFilter(snapshot).works).toEqual([])
    expect(applyLocusFilter(snapshot, { buckets: ['serving', 'down'] }).works).toEqual([])
    const shown = applyLocusFilter(snapshot, { buckets: ['archived'] })
    expect(locusStateLabel(shown.works[0]!.chats[0]!.chat.group.state)).toBe('已停止')
  })

  it('spec Scenario "默认隐藏已停止与已失效的入口"', () => {
    const stopped = entryView({ chatId: 'oc_S', state: 'stopped' })
    const invalid = entryView({ chatId: 'oc_I', state: 'invalid' })
    const snapshot = snapshotV20([workView([chatView(stopped), chatView(invalid)])])
    expect(applyLocusFilter(snapshot, DEFAULT_LOCUS_FILTER).works).toEqual([])
    expect(entryStateFilterLabel(DEFAULT_LOCUS_FILTER)).toBe('在服务')
    expect(countLocusFilterOptions(snapshot).get('down')).toBe(2)
    expect(entryStateNote(invalid)).toBe(LOCUS_INVALID_NOTE)
    expect(entryStateNote(stopped)).toBe(LOCUS_STOPPED_NOTE)
  })

  it('spec Scenario "未创建入口默认可见"', () => {
    const snapshot = snapshotV20([workView([chatView(
      entryView({ chatId: 'oc_A', state: 'not-created' }),
      [entryView({ chatId: 'oc_A', threadId: 'omt_1', state: 'not-created' })],
    )])])
    const chat = applyLocusFilter(snapshot).works[0]!.chats[0]!
    expect(chat.groupVisible).toBe(true)
    expect(chat.topics).toHaveLength(1)
    expect(locusStateLabel('not-created')).toBe('未创建')
    expect(countLocusFilterOptions(snapshot).get('serving')).toBe(2)
  })

  it('spec Scenario "已停止群行下仍有活跃话题"', () => {
    const snapshot = snapshotV20([workView([chatView(
      entryView({ chatId: 'oc_A', state: 'stopped' }),
      [entryView({ chatId: 'oc_A', threadId: 'omt_1' })],
    )])])
    const chat = applyLocusFilter(snapshot).works[0]!.chats[0]!
    expect(chat.groupVisible).toBe(false)
    expect(chat.chat.group.state).toBe('stopped')
    expect(chat.topics.map(topic => topic.endpoint.threadId)).toEqual(['omt_1'])
    expect(summarizeLocusView(applyLocusFilter(snapshot)).entries).toBe(1)
  })

  it('spec Scenario "筛选只影响呈现"', () => {
    const snapshot = snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', state: 'stopped' }))])])
    const before = JSON.stringify(snapshot)
    applyLocusFilter(snapshot, SHOW_ALL_LOCUS_FILTER)
    applyLocusFilter(snapshot, DEFAULT_LOCUS_FILTER)
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it('spec Scenario "筛选后为空时说明可放宽的条件"', () => {
    const snapshot = snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', state: 'stopped' }))])])
    expect(applyLocusFilter(snapshot).works).toEqual([])
    expect(emptyListText('')).toContain('勾选「已停止 / 已失效」')
    expect(emptyListText('')).not.toMatch(/删除/)
  })

  it('narrows by search without resurrecting what the filter hid', () => {
    const snapshot = snapshotV20([workView([
      chatView(entryView({ chatId: 'oc_A', chatName: '项目群' })),
      chatView(entryView({ chatId: 'oc_B', state: 'stopped', chatName: '项目群旧' })),
    ])])
    const codes = collectHandleCodes(snapshot)
    const view = applyQuery(applyLocusFilter(snapshot), codes, '项目群')
    expect(view.works[0]?.chats.map(chat => chat.chat.group.endpoint.chatId)).toEqual(['oc_A'])
  })
})

describe('spec Requirement "完全访问由 allowlist 显式授予且如实说明" (management half)', () => {
  it('spec Scenario "关闭期间管理面只禁用完全访问选项"', () => {
    const entry = entryView({ chatId: 'oc_A' })
    expect(fullAccessBlock({ writeEnabled: false })).toBe(LOCUS_WRITE_DISABLED_REASON)
    expect(accessBlock(entry)).toBeUndefined()
    expect(fullAccessBlock({ writeEnabled: true })).toBeUndefined()
  })
})

describe('spec Requirement "管理面提供双向可达且目标不可达时 fail closed"', () => {
  it('spec Scenario "两种读法同源一致"', () => {
    const snapshot = snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }), [entryView({ chatId: 'oc_A', threadId: 'omt_1' })])])])
    const view = applyLocusFilter(snapshot)
    const [byEntry] = groupByEntry(view)
    const byWork = view.works[0]!
    expect(byEntry?.work.sessionId).toBe(byWork.work.sessionId)
    expect(byEntry?.section.chat.locusMain.sessionId).toBe(byWork.chats[0]!.chat.locusMain.sessionId)
    expect(byEntry?.section.topics.map(topic => [topic.locusId, topic.sessionId]))
      .toEqual(byWork.chats[0]!.topics.map(topic => [topic.locusId, topic.sessionId]))
  })

  it('spec Scenario "父会话已归档时不可跳转"', () => {
    expect(sessionJumpBlock('archived')).toBe('会话已归档，无法打开')
    expect(sessionJumpBlock('missing')).toBe('会话不可用，无法打开')
    expect(sessionJumpBlock('unknown')).toBeDefined()
    expect(sessionJumpBlock('available')).toBeUndefined()
  })

  it('spec Scenario "话题身份不可证时退化"', () => {
    expect(entryFeishuTarget({ chatId: 'oc_A', threadId: 'omt_19cd' }, chatLink)).toMatchObject({ kind: 'thread' })
    const degraded = entryFeishuTarget({ chatId: 'oc_A', threadId: 'not-a-topic' }, chatLink)
    expect(degraded).toMatchObject({ kind: 'chat', url: chatLink('oc_A'), reason: '无法证明话题标识，已退化为所属群' })
  })

  it('spec Scenario "未创建的入口没有子会话可跳转"', () => {
    expect(childJumpBlock(entryView({ chatId: 'oc_A', state: 'not-created' }))).toBe('尚未创建')
    expect(childJumpBlock(entryView({ chatId: 'oc_A' }))).toBeUndefined()
  })
})

describe('spec Requirement "默认 Q&A 在管理面只读呈现"', () => {
  it('spec Scenario "默认 Q&A 只做标记"', () => {
    const snapshot = snapshotV20([workView([chatView(entryView({ chatId: 'oc_Q' }), [entryView({ chatId: 'oc_Q', threadId: 'omt_1' })], { defaultQa: true })])])
    const view = applyLocusFilter(snapshot)
    expect(view.works[0]?.hasDefaultQa).toBe(true)
    expect(summarizeLocusView(view).chats).toBe(1)
    expect(view.works[0]?.chats[0]?.topics[0]).not.toHaveProperty('defaultQa')
  })

  it('spec Scenario "尚无默认 Q&A 时说明出处"', () => {
    const view = applyLocusFilter(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }))])]))
    expect(view.works[0]?.hasDefaultQa).toBe(false)
    expect(LOCUS_DEFAULT_QA_MISSING_NOTE).toContain('请在目标会话中通过 Pet 轮盘')
  })
})

describe('spec Requirement "管理面如实呈现全部生命周期状态"', () => {
  it('spec Scenario "正在建树的入口可见"', () => {
    const entry = entryView({ chatId: 'oc_A', state: 'not-created' })
    expect(locusStateLabel(entry.state)).toBe('未创建')
    expect(locusStateTone(entry.state)).toBe('on')
    expect(applyLocusFilter(snapshotV20([workView([chatView(entry)])])).works).toHaveLength(1)
    expect(accessBlock(entry)).toBeUndefined()
  })

  it('spec Scenario "非活跃状态不被省略"', () => {
    expect(Object.keys(LOCUS_STATE_LABELS).sort()).toEqual(['active', 'invalid', 'not-created', 'stopped'])
    expect(locusStateLabel('stopped')).toBe('已停止')
    expect(locusStateLabel('invalid')).toBe('已失效')
    expect(locusStateLabel('retired')).toBe('未知状态')
  })
})

describe('spec Requirement "管理面呈现文档入口且不提供新建入口" (view half)', () => {
  it('spec Scenario "改绑动作只在文档根行"', () => {
    const root = entryView({ chatId: 'doc:docx:D', chatName: '技术方案' })
    const chat = chatView(root, [entryView({ chatId: 'doc:docx:D', threadId: '11' }), entryView({ chatId: 'doc:docx:D', threadId: '22' })])
    expect(rebindBlock(chat, { sessionId: 'W', availability: 'archived' })).toBeUndefined()
    expect(rebindBlock(chat, { sessionId: 'W', availability: 'available' })).toBe('当前来源会话未归档，仅在其归档后可改绑')
  })
})

describe('short codes', () => {
  it('follows one documented rule per kind', () => {
    expect(handleCode('oc_a27b5de7e6a9a57462060eb289ec70ab', 'endpoint')).toBe('a27b')
    expect(handleCode('omt_19cd829b840f5bee', 'endpoint')).toBe('19cd')
    expect(handleCode('session-906220d3-ecee-41d0-9320-f425f17edefe', 'session')).toBe('9062')
    // The timestamp segment of a locus id has no discriminating power, so the
    // code comes from the trailing segment instead.
    expect(handleCode('locus-runtime-1789394541339-2f853e76111d38', 'locus')).toBe('2f85')
    expect(handleCode('d5d2ebd5-7296-42c9-a34a-16753deb417b', 'workspace')).toBe('d5d2')
  })

  it('carries the object type into the label the surface shows', () => {
    // Six bare fragments in one row are indistinguishable; the prefix is what
    // makes a session code readable next to a locus code.
    expect(handleLabel('locus', '2f85')).toBe('L·2f85')
    expect(handleLabel('session', '9062')).toBe('S·9062')
    expect(handleLabel('workspace', 'd5d2')).toBe('W·d5d2')
    expect(endpointHandleLabel({ chatId: 'oc_a' }, 'a27b')).toBe('oc·a27b')
    expect(endpointHandleLabel({ chatId: 'oc_a', threadId: 'omt_1' }, '19cd')).toBe('omt·19cd')
    expect(handleLabel('session', '')).toBe('')
  })

  it('returns nothing for a blank id rather than a bogus code', () => {
    expect(handleCode('   ', 'session')).toBe('')
  })

  it('lengthens only the colliding codes, and only as far as needed', () => {
    const ids = ['session-906220d3-aaaa', 'session-90622111-bbbb', 'session-ffffffff-cccc']
    const codes = assignHandleCodes(ids, 'session')
    // The first two share '9062', so both grow to six characters; the third is
    // already unique and keeps the shortest code.
    expect(codes.get(ids[0])).toBe('906220')
    expect(codes.get(ids[1])).toBe('906221')
    expect(codes.get(ids[2])).toBe('ffff')
  })

  it('never lets two rows share an alias when only the full id differs', () => {
    // Same uuid prefix, differing only in a later group: no length of the
    // distinguishing substring can separate them, so the alias falls back to the
    // whole identifier rather than collapsing two rows into one label.
    const ids = ['session-906220d3-aaaa', 'session-906220d3-bbbb']
    const codes = assignHandleCodes(ids, 'session')
    expect(codes.get(ids[0])).toBe(ids[0])
    expect(codes.get(ids[1])).toBe(ids[1])
    expect(new Set(codes.values()).size).toBe(2)
  })

  it('keeps the shortest code when there is no collision', () => {
    const codes = assignHandleCodes(['session-12345678-a', 'session-abcdef12-b'], 'session')
    expect(codes.get('session-12345678-a')).toBe('1234')
  })
})

describe('names', () => {
  it('spec Scenario "名称不可得时不猜测": never calls an untyped chat a group', () => {
    const endpoint = { chatId: 'oc_a27b5de7e6a9a57462060eb289ec70ab' }
    const display = entryDisplayName(endpoint, 'a27b')
    expect(display.name).toBe('入口 · a27b')
    expect(display.isPlaceholder).toBe(true)
    expect(display.role.label).toBe('入口')
  })

  it('uses a topic role for a thread endpoint', () => {
    const display = entryDisplayName({ chatId: 'oc_a', threadId: 'omt_19cd829b840f5bee' }, '19cd')
    expect(display.name).toBe('话题 · 19cd')
    expect(display.role.isTopic).toBe(true)
  })

  it('prefers a provided name and marks it as real', () => {
    const display = entryDisplayName({ chatId: 'oc_a', chatName: '答疑 · DSH' }, 'a27b')
    expect(display.name).toBe('答疑 · DSH')
    expect(display.isPlaceholder).toBe(false)
  })

  it('falls back to the raw id only when no code could be derived', () => {
    expect(entryDisplayName({ chatId: 'oc_a' }, '').name).toBe('入口 · oc_a')
  })
})

describe('doc-comment entries (pet-locus-doc-comments D14)', () => {
  it('spec Scenario "文档入口短码确定且与群可区分"', () => {
    const doc = { chatId: 'doc:docx:AbCdEf123' }
    const chat = { chatId: 'oc_AbCdEf123' }
    const docCodes = assignHandleCodes([endpointHandleId(doc)], 'endpoint')
    const again = assignHandleCodes([endpointHandleId(doc)], 'endpoint')
    const chatCodes = assignHandleCodes([endpointHandleId(chat)], 'endpoint')
    const docLabel = endpointHandleLabel(doc, docCodes.get(endpointHandleId(doc)) ?? '')
    const chatLabel = endpointHandleLabel(chat, chatCodes.get(endpointHandleId(chat)) ?? '')

    expect(docLabel).toBe('doc·AbCd')
    expect(endpointHandleLabel(doc, again.get(endpointHandleId(doc)) ?? '')).toBe(docLabel)
    expect(chatLabel).toBe('oc·AbCd')
    expect(docLabel).not.toBe(chatLabel)
  })

  it('spec Scenario "多个文档入口短码互不相同"', () => {
    const ids = ['doc:docx:AAAA1111', 'doc:docx:AAAA2222']
    const codes = assignHandleCodes(ids, 'endpoint')
    const labels = ids.map(id => endpointHandleLabel({ chatId: id }, codes.get(id) ?? ''))

    expect(new Set(labels).size).toBe(2)
    for (const label of labels) expect(label.startsWith('doc·doc')).toBe(false)
    expect(labels).toEqual(['doc·AAAA11', 'doc·AAAA22'])
  })

  it('spec Scenario "同前缀的评论入口短码可区分": reversed comment ids', () => {
    const root = 'doc:docx:AAAA1111'
    const a = { chatId: root, threadId: '7696945640885996815' }
    const b = { chatId: root, threadId: '7696945648012135660' }
    const codes = assignHandleCodes([endpointHandleId(a), endpointHandleId(b)], 'endpoint')

    expect(endpointHandleLabel(a, codes.get(endpointHandleId(a)) ?? '')).toBe('cmt·5186')
    expect(endpointHandleLabel(b, codes.get(endpointHandleId(b)) ?? '')).toBe('cmt·0665')
  })

  it('spec Scenario "文档标题不可得": 文档 · <code> and 评论 · <code> fallbacks, marked as placeholders', () => {
    const doc = entryDisplayName({ chatId: 'doc:docx:AbCdEf123' }, 'AbCd')
    const comment = entryDisplayName({ chatId: 'doc:docx:AbCdEf123', threadId: '7696945640885996815' }, '5186')

    expect(doc).toMatchObject({ name: '文档 · AbCd', isPlaceholder: true })
    expect(comment).toMatchObject({ name: '评论 · 5186', isPlaceholder: true })
    expect(doc.role.label).toBe('文档')
    expect(comment.role).toMatchObject({ label: '评论', isTopic: true })
  })

  it('names a document by its title, and a comment by its quote summary', () => {
    expect(entryDisplayName({ chatId: 'doc:docx:AbCdEf123', chatName: '技术方案' }, 'AbCd'))
      .toMatchObject({ name: '技术方案', isPlaceholder: false })
    expect(entryDisplayName({ chatId: 'doc:docx:AbCdEf123', threadId: '9', quote: '接口已有，为什么还要新增' }, '9'))
      .toMatchObject({ name: '「接口已有，为什么还要新增」', isPlaceholder: false })
  })

  it('leaves IM rules unchanged', () => {
    expect(endpointHandleLabel({ chatId: 'oc_x', threadId: 'omt_abc' }, 'abc')).toBe('omt·abc')
    expect(entryDisplayName({ chatId: 'oc_x' }, 'x')).toMatchObject({ name: '入口 · x' })
  })
})
