/**
 * Real DOM-structure tests for the todo panel.
 *
 * These exist because the first version of this panel shipped visually broken
 * while every source-string assertion passed: it reused `.dshpet-locus-row`
 * (a two-column grid built for a name/tail pair) with four children, and
 * `.dshpet-badge` (an absolutely-positioned mascot counter) as an inline
 * label. Asserting on rendered markup — not on the source text of the
 * component — is what catches that class of defect.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocusSurface } from '../src/client/settings.js'
import { PET_CSS } from '../src/client/styles.js'
import type { PetLocusManagementView } from '../src/wire.js'

const snapshot = {
  generation: 1,
  loci: [{
    locusId: 'locus-1',
    generation: 1,
    endpoint: { chatId: 'oc_chat' },
    main: { sessionId: 'main-1', availability: 'available' as const, title: '主会话' },
    child: { sessionId: 'child-1', availability: 'available' as const },
    workspace: { workspaceId: 'ws-1' },
    permission: { desired: 'read' as const, effective: 'read' as const },
    state: { state: 'active' as const, busy: false, createdAt: 1, updatedAt: 1 },
    source: 'auto' as const,
    isDefaultQa: false,
  }],
  defaultQa: [],
  discovery: { byEndpoint: [], byParent: [], byChild: [] },
} as unknown as PetLocusManagementView

const groups = [{
  parentSessionId: 'main-1',
  items: [{
    itemId: 'todo-1',
    locusId: 'locus-1',
    generation: 1,
    endpoint: { chatId: 'oc_chat' },
    triggerMessageId: 'om_1',
    requestedBy: 'ou_322ec1d3cd062f04bc2b1f4ba1eff8e9',
    summary: 'Pet 任务面板的空状态仍是英文，需汉化',
    detail: '位置：overlay.tsx:1100-1103\n注意 `No ${tab} tasks.` 是语法拼接',
    status: 'open' as const,
    createdAt: Date.now(),
    statusChangedAt: Date.now(),
  }],
}]

/**
 * Renders the real `LocusSurface`, not a todo component in isolation: todos
 * now live inside each parent session's block, so rendering them detached
 * would no longer prove what the owner actually sees.
 */
function render(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(LocusSurface, {
    snapshot,
    onAction: () => {},
    runQuery: async () => undefined,
    initialTodoGroups: groups,
    initialTodosOpen: true,
    ...overrides,
  } as never))
}

describe('todo panel renders a sound box model', () => {
  it('never reuses the two-column locus-row grid or the absolutely-positioned badge', () => {
    // Scope to the todo article: the surrounding page legitimately renders
    // `.dshpet-locus-row` for its own entry rows, so a whole-page assertion
    // would be meaningless. What must never recur is a TODO built from them.
    const markup = render()
    const start = markup.indexOf('<article class="dshpet-todo"')
    expect(start).toBeGreaterThan(-1)
    const article = markup.slice(start, markup.indexOf('</article>', start))
    expect(article).not.toContain('dshpet-locus-row')
    expect(article).not.toContain('dshpet-badge')
  })

  it('renders each todo as a flat block owning its own class namespace', () => {
    const markup = render()
    expect(markup).toContain('class="dshpet-todo"')
    expect(markup).toContain('data-status="open"')
    expect(markup).toContain('dshpet-todo-summary')
    expect(markup).toContain('dshpet-todo-meta')
    expect(markup).toContain('dshpet-todo-actions')
  })

  it('every class the panel emits is actually defined in the stylesheet', () => {
    // The unstyled `dshpet-pre` / `dshpet-locus-fold` classes in the first
    // version had no rules at all, so the evidence block rendered raw.
    const markup = render()
    const emitted = new Set(
      [...markup.matchAll(/class="([^"]+)"/g)]
        .flatMap(match => match[1]!.split(/\s+/))
        .filter(name => name.startsWith('dshpet-')),
    )
    const undefinedClasses = [...emitted].filter(name => !PET_CSS.includes(`.${name}`))
    expect(undefinedClasses).toEqual([])
  })

  it('puts the status label in the meta line, not overlapping the summary', () => {
    const markup = render()
    const summaryAt = markup.indexOf('dshpet-todo-summary')
    const metaAt = markup.indexOf('dshpet-todo-meta')
    const statusAt = markup.indexOf('dshpet-status')
    expect(summaryAt).toBeGreaterThan(-1)
    // The status chip lives after the summary and inside the meta row.
    expect(statusAt).toBeGreaterThan(metaAt)
    expect(metaAt).toBeGreaterThan(summaryAt)
  })

  it('truncates the opaque open id with a title fallback instead of letting it overflow', () => {
    const markup = render()
    expect(markup).toContain('dshpet-todo-who')
    expect(markup).toContain('title="ou_322ec1d3cd062f04bc2b1f4ba1eff8e9"')
    expect(PET_CSS).toContain('.dshpet-todo-who')
    expect(PET_CSS).toMatch(/\.dshpet-todo-who\{[^}]*text-overflow:ellipsis/)
  })

  it('renders evidence as a collapsed details block with the monospace excerpt treatment', () => {
    const markup = render()
    expect(markup).toContain('dshpet-todo-evidence')
    expect(markup).toContain('dshpet-todo-evidence-body')
    expect(markup).toContain('登记时查到的证据')
    // Not open by default: the summary is what the owner scans.
    expect(markup).not.toMatch(/<details[^>]*\sopen/)
    expect(PET_CSS).toMatch(/\.dshpet-todo-evidence-body\{[^}]*white-space:pre-wrap/)
  })

  it('offers exactly the legal actions for the status and labels them with the verb they perform', () => {
    const markup = render()
    for (const label of ['受理', '完成', '放弃']) expect(markup).toContain(label)
  })

  it('shows only terminal-safe output for a done todo — no actions offered', () => {
    const done = [{ ...groups[0]!, items: [{ ...groups[0]!.items[0]!, status: 'done' as const }] }]
    const markup = render({ initialTodoGroups: done })
    expect(markup).toContain('data-status="done"')
    expect(markup).not.toContain('受理')
    expect(markup).not.toContain('放弃')
  })

  it('keeps the toggle label stable and moves the count beside it', () => {
    const markup = render()
    // A button's accessible name must not change as data changes: the count
    // rides in a sibling span, never in the label.
    expect(markup).toContain('dshpet-work-todos-head')
    expect(markup).toMatch(/<span>待办<\/span>/)
    expect(markup).toContain('dshpet-work-todos-count')
    expect(markup).toContain('1 条待处理')
  })

  it('renders no todo block at all for a session with nothing filed', () => {
    // Now that todos live inside a session block, an always-present empty
    // shell would be noise on every healthy session. Absence is the empty
    // state.
    const markup = render({ initialTodoGroups: [] })
    expect(markup).not.toContain('dshpet-work-todos')
    expect(markup).not.toContain('dshpet-todo-summary')
  })
})

describe('todo rows actually navigate, not merely describe', () => {
  it('a chat-level todo links to the real chat applink format this panel already ships', () => {
    const markup = render()
    expect(markup).toContain('https://applink.feishu.cn/client/chat/open?openChatId=oc_chat')
    expect(markup).toContain('target="_blank"')
  })

  it('a thread todo links to the thread applink instead of the chat', () => {
    const threaded = [{
      ...groups[0]!,
      items: [{ ...groups[0]!.items[0]!, endpoint: { chatId: 'oc_chat', threadId: 'omt_x' } }],
    }]
    const threadedSnapshot = {
      ...snapshot,
      loci: [{ ...snapshot.loci[0]!, endpoint: { chatId: 'oc_chat', threadId: 'omt_x' } }],
    } as unknown as PetLocusManagementView
    const markup = render({ initialTodoGroups: threaded, snapshot: threadedSnapshot })
    expect(markup).toContain('https://applink.feishu.cn/client/thread/open?threadId=omt_x')
    expect(markup).not.toContain('client/chat/open')
  })

  it('never appends triggerMessageId to an applink — neither format accepts a message selector', () => {
    const markup = render()
    expect(markup).not.toContain('om_1')
  })

  it('offers a session jump whose label says what it opens', () => {
    const markup = render()
    expect(markup).toContain('>会话')
    expect(markup).toContain('打开登记这条待办的子会话')
  })

  it('disables the session jump and states the reason when the child is archived', () => {
    const archived = {
      ...snapshot,
      loci: [{ ...snapshot.loci[0]!, child: { sessionId: 'child-1', availability: 'archived' as const } }],
    } as unknown as PetLocusManagementView
    const markup = render({ snapshot: archived })
    expect(markup).toContain('会话已归档')
    // A disabled Jump renders as a button, never as a live anchor.
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>会话/)
  })

  it('every disposition button explains what it does and that nothing is sent to Feishu', () => {
    const markup = render()
    for (const hint of ['仍可稍后完成或放弃', '终态', '不发送任何飞书消息']) {
      expect(markup).toContain(hint)
    }
  })
})

describe('parent-session list is paged and collapsible', () => {
  /** N sessions, each with one entry, so page math is by SESSION not entry. */
  function manySessions(count: number): PetLocusManagementView {
    return {
      ...snapshot,
      loci: Array.from({ length: count }, (_, i) => ({
        ...snapshot.loci[0]!,
        locusId: `locus-${i}`,
        endpoint: { chatId: `oc_chat_${i}` },
        main: { sessionId: `main-${i}`, availability: 'available' as const, title: `会话 ${i}` },
        child: { sessionId: `child-${i}`, availability: 'available' as const },
      })),
    } as unknown as PetLocusManagementView
  }

  it('renders no pager when everything fits on one page', () => {
    const markup = render({ snapshot: manySessions(3), initialTodoGroups: [] })
    expect(markup).not.toContain('dshpet-pager')
  })

  it('renders a pager above AND below the list once it overflows', () => {
    const markup = render({ snapshot: manySessions(20), initialTodoGroups: [] })
    expect(markup).toContain('data-position="top"')
    expect(markup).toContain('data-position="bottom"')
  })

  it('states the visible slice rather than only a page number', () => {
    const markup = render({ snapshot: manySessions(20), initialTodoGroups: [] })
    expect(markup).toContain('1–8 / 20 个父会话')
  })

  it('shows only one page of sessions at a time', () => {
    const markup = render({ snapshot: manySessions(20), initialTodoGroups: [] })
    // Count blocks rather than naming sessions: the list sorts by title, so
    // which eight land on page one is the sort's business, not this test's.
    const blocks = [...markup.matchAll(/class="dshpet-work"/g)]
    expect(blocks).toHaveLength(8)
  })

  it('disables "上一页" on the first page', () => {
    const markup = render({ snapshot: manySessions(20), initialTodoGroups: [] })
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>上一页/)
  })

  it('collapses each session by default and says how many entries are hidden', () => {
    const markup = render({ snapshot: manySessions(3), initialTodoGroups: [] })
    expect(markup).toContain('dshpet-work-expand')
    expect(markup).toContain('1 个入口')
    expect(markup).toContain('aria-expanded="false"')
    // Entry rows stay out of the DOM until the session is expanded.
    expect(markup).not.toContain('dshpet-rail')
  })

  it('renders entry rows once a session is expanded', () => {
    const markup = render({
      snapshot: manySessions(3), initialTodoGroups: [], initialWorksExpanded: true,
    })
    expect(markup).toContain('dshpet-rail')
    expect(markup).toContain('dshpet-locus-row')
  })

  it('keeps a session\'s todos visible even while its entries are collapsed', () => {
    // An outstanding request is the reason to look at a session at all, so it
    // must not be hidden behind the same toggle as routine entry detail.
    const markup = render()
    expect(markup).not.toContain('dshpet-rail')
    expect(markup).toContain('dshpet-work-todos')
    expect(markup).toContain('dshpet-todo-summary')
  })
})
