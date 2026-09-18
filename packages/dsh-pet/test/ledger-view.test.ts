import { describe, expect, it } from 'vitest'
import {
  availableTodoActions,
  groupTodosByLocus,
  isTodoActionable,
  resolveFeishuJumpTarget,
  resolveFeishuJumpUrl,
  resolveSessionJumpTarget,
  todoStatusLabel,
  type TodoSnapshotItem,
} from '../src/client/ledger-view.js'

function item(overrides: Partial<TodoSnapshotItem> = {}): TodoSnapshotItem {
  return {
    itemId: 'todo-1',
    locusId: 'locus-1',
    endpoint: { chatId: 'oc-project' },
    triggerMessageId: 'om_trigger',
    requestedBy: 'ou_requester',
    summary: 'summary',
    detail: 'detail',
    status: 'open',
    createdAt: 1_000,
    statusChangedAt: 1_000,
    ...overrides,
  }
}

describe('resolveFeishuJumpTarget (task 8.3)', () => {
  it('spec Scenario "话题待办跳回原话题": a proven threadId resolves to a thread-kind target', () => {
    const target = resolveFeishuJumpTarget(item({ endpoint: { chatId: 'oc-x', threadId: 'omt-y' } }))
    expect(target).toEqual({ kind: 'thread', chatId: 'oc-x', threadId: 'omt-y', messageId: 'om_trigger' })
  })

  it('spec Scenario "话题身份不可证时退化": a todo from a chat-level endpoint (no threadId at all) degrades honestly, does not fabricate a thread', () => {
    const target = resolveFeishuJumpTarget(item({ endpoint: { chatId: 'oc-x' } }))
    expect(target).toEqual({ kind: 'chat-degraded', chatId: 'oc-x', messageId: 'om_trigger', reason: '该待办来自群本体，非话题' })
  })

  it('an empty/whitespace threadId is treated as unproven, not as a valid thread id', () => {
    const target = resolveFeishuJumpTarget(item({ endpoint: { chatId: 'oc-x', threadId: '   ' } }))
    expect(target.kind).toBe('chat-degraded')
    if (target.kind === 'chat-degraded') expect(target.reason).toContain('无法证明话题标识')
  })

  it('never invents a threadId when degrading — the degraded target carries no threadId field at all', () => {
    const target = resolveFeishuJumpTarget(item({ endpoint: { chatId: 'oc-x' } }))
    expect('threadId' in target).toBe(false)
  })
})

describe('resolveFeishuJumpUrl', () => {
  it('calls the thread builder for a thread target, with exactly the resolved facts', () => {
    const target = resolveFeishuJumpTarget(item({ endpoint: { chatId: 'oc-x', threadId: 'omt-y' } }))
    const url = resolveFeishuJumpUrl(target, {
      threadUrl: (chatId, threadId, messageId) => `thread://${chatId}/${threadId}/${messageId}`,
      chatUrl: () => 'should-not-be-called',
    })
    expect(url).toBe('thread://oc-x/omt-y/om_trigger')
  })

  it('calls the chat builder for a degraded target', () => {
    const target = resolveFeishuJumpTarget(item({ endpoint: { chatId: 'oc-x' } }))
    const url = resolveFeishuJumpUrl(target, {
      threadUrl: () => 'should-not-be-called',
      chatUrl: (chatId, messageId) => `chat://${chatId}/${messageId}`,
    })
    expect(url).toBe('chat://oc-x/om_trigger')
  })
})

describe('resolveSessionJumpTarget (task 8.4)', () => {
  it('spec Scenario "会话已归档时不可跳转": an archived current-generation session is not openable', () => {
    expect(resolveSessionJumpTarget('child-1', 'archived')).toEqual({ kind: 'unavailable', reason: '会话已归档' })
  })

  it('a missing session is not openable', () => {
    expect(resolveSessionJumpTarget('child-1', 'missing')).toEqual({ kind: 'unavailable', reason: '会话不可用' })
  })

  it('an available session is openable and returns its id', () => {
    expect(resolveSessionJumpTarget('child-1', 'available')).toEqual({ kind: 'available', sessionId: 'child-1' })
  })

  it('spec Scenario "退役 locus 的待办仍在列表中": no current child session at all (retired locus) is unavailable but does not throw', () => {
    expect(resolveSessionJumpTarget(undefined, undefined)).toEqual({
      kind: 'unavailable',
      reason: '该 locus 当前代无子会话，或来源已失效',
    })
  })
})

describe('todoStatusLabel / isTodoActionable / availableTodoActions', () => {
  it('labels every status in Chinese', () => {
    expect(todoStatusLabel('open')).toBe('待处理')
    expect(todoStatusLabel('accepted')).toBe('已受理')
    expect(todoStatusLabel('done')).toBe('已完成')
    expect(todoStatusLabel('dropped')).toBe('已放弃')
  })

  it('open and accepted are actionable; done and dropped are not (mirrors ledger/todo.ts#isTodoTerminal, inverted)', () => {
    expect(isTodoActionable('open')).toBe(true)
    expect(isTodoActionable('accepted')).toBe(true)
    expect(isTodoActionable('done')).toBe(false)
    expect(isTodoActionable('dropped')).toBe(false)
  })

  it('availableTodoActions matches the exact legal-transition table from ledger/todo.ts', () => {
    expect(availableTodoActions('open')).toEqual(['accept', 'done', 'drop'])
    expect(availableTodoActions('accepted')).toEqual(['done', 'drop'])
    expect(availableTodoActions('done')).toEqual([])
    expect(availableTodoActions('dropped')).toEqual([])
  })
})

describe('groupTodosByLocus', () => {
  it('groups by locusId, not by generation — items from different generations of the same locus group together (design D6)', () => {
    const groups = groupTodosByLocus([
      item({ itemId: 'a', locusId: 'locus-x' }),
      item({ itemId: 'b', locusId: 'locus-x' }),
      item({ itemId: 'c', locusId: 'locus-y' }),
    ])
    expect([...groups.keys()].sort()).toEqual(['locus-x', 'locus-y'])
    expect(groups.get('locus-x')?.map(i => i.itemId)).toEqual(['a', 'b'])
    expect(groups.get('locus-y')?.map(i => i.itemId)).toEqual(['c'])
  })

  it('spec: empty-state — an empty list groups to an empty map, not an error or a placeholder group', () => {
    expect(groupTodosByLocus([]).size).toBe(0)
  })
})

describe('owner-facing todo routes are actually wired (regression guards)', () => {
  it('both routes are declared in LOCUS_ROUTES and registered exactly once in routes.ts', async () => {
    // wire.ts states the invariant explicitly: "A declared route must be
    // registered exactly once". A declared-but-unmounted route would 404 with
    // no type error — exactly the class of defect that let the three
    // intent-triage tools ship unregistered earlier in this change.
    const fs = await import('node:fs')
    const wire = fs.readFileSync(new URL('../src/wire.ts', import.meta.url), 'utf8')
    const routes = fs.readFileSync(new URL('../src/host/routes.ts', import.meta.url), 'utf8')
    for (const key of ['todos', 'todoAction']) {
      expect(wire).toContain(`${key}: '/dsh-pet/api/locus-`)
      const mounts = [...routes.matchAll(new RegExp(`petRoute\\(LOCUS_ROUTES\\.${key},`, 'g'))]
      expect(mounts).toHaveLength(1)
    }
  })

  it('the Host actually supplies todoLedger to createPetRoutes — a declared dep nobody passes is the same defect as an unmounted route', async () => {
    const fs = await import('node:fs')
    const index = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const start = index.indexOf('createPetRoutes({')
    expect(start).toBeGreaterThan(-1)
    // Slice a generous window covering the whole argument object.
    expect(index.slice(start, start + 6000)).toContain('todoLedger:')
  })

  it('both routes require owner proof, so a browser cannot list or dispose of todos without it', async () => {
    const fs = await import('node:fs')
    const routes = fs.readFileSync(new URL('../src/host/routes.ts', import.meta.url), 'utf8')
    const todosStart = routes.indexOf('petRoute(LOCUS_ROUTES.todos,')
    const actionStart = routes.indexOf('petRoute(LOCUS_ROUTES.todoAction,')
    const statusStart = routes.indexOf('petRoute(ROUTES.status,')
    expect(todosStart).toBeGreaterThan(-1)
    expect(actionStart).toBeGreaterThan(todosStart)
    expect(routes.slice(todosStart, actionStart)).toContain('requireLocusActor()')
    expect(routes.slice(actionStart, statusStart)).toContain('requireLocusActor()')
  })

  it('an absent ledger fails closed with LOCUS_UNAVAILABLE rather than reporting an empty list', async () => {
    const fs = await import('node:fs')
    const routes = fs.readFileSync(new URL('../src/host/routes.ts', import.meta.url), 'utf8')
    const todosStart = routes.indexOf('petRoute(LOCUS_ROUTES.todos,')
    const statusStart = routes.indexOf('petRoute(ROUTES.status,')
    const block = routes.slice(todosStart, statusStart)
    // "no todos" and "this Host has no ledger" must stay distinguishable.
    expect([...block.matchAll(/LOCUS_UNAVAILABLE/g)]).toHaveLength(2)
  })

  it('the settings panel renders the fold and dispatches through the pure model', async () => {
    const fs = await import('node:fs')
    const settings = fs.readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')
    // Todos render inside each parent session's block, not as a standalone
    // section: one ledger read at panel level, redistributed per session.
    expect(settings).toContain('<WorkTodos')
    expect(settings).toContain('function WorkTodos')
    expect(settings).toContain('function useTodoLedger')
    expect(settings).toContain('todos.byParent.get(work.parentSessionId)')
    // Display decisions must come from ledger-view.ts, not be re-derived here.
    for (const fn of ['groupTodosByLocus', 'todoStatusLabel', 'availableTodoActions', 'resolveFeishuJumpTarget', 'resolveSessionJumpTarget']) {
      expect(settings).toContain(fn)
    }
    // Re-reads after a disposition instead of patching state optimistically.
    expect(settings).toContain('await petApi.locusTodoAction(')
    expect(settings).toContain('await load()')
  })
})
