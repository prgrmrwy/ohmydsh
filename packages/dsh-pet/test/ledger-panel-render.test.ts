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
import { TodoLedgerFold } from '../src/client/settings.js'
import { PET_CSS } from '../src/client/styles.js'
import type { PetLocusManagementView } from '../src/wire.js'

const snapshot = {
  generation: 1,
  loci: [{
    locusId: 'locus-1',
    generation: 1,
    endpoint: { chatId: 'oc_chat' },
    main: { sessionId: 'main-1' },
    child: { sessionId: 'child-1', availability: 'available' as const },
    workspace: { workspaceId: 'ws-1' },
    permission: { desired: 'read' as const, effective: 'read' as const },
    state: { value: 'active' as const },
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

function render(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(TodoLedgerFold, {
    snapshot, disabled: false, initialGroups: groups, initialOpen: true, ...overrides,
  } as never))
}

describe('todo panel renders a sound box model', () => {
  it('never reuses the two-column locus-row grid or the absolutely-positioned badge', () => {
    const markup = render()
    // The exact two classes that broke the first version.
    expect(markup).not.toContain('dshpet-locus-row')
    expect(markup).not.toContain('dshpet-badge')
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
    const markup = render({ initialGroups: done })
    expect(markup).toContain('data-status="done"')
    expect(markup).not.toContain('受理')
    expect(markup).not.toContain('放弃')
  })

  it('keeps the toggle label stable and moves the count beside it', () => {
    const markup = render()
    // A button's accessible name must not change as data changes.
    expect(markup).toMatch(/aria-expanded="true"[^>]*>待办</)
    expect(markup).toContain('dshpet-todo-count')
  })

  it('states an actionable empty message rather than a bare "none"', () => {
    const markup = render({ initialGroups: [] })
    expect(markup).toContain('还没有待办')
    expect(markup).toContain('子会话遇到做不了的改动请求时会记在这里')
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
    const markup = render({ initialGroups: threaded })
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
