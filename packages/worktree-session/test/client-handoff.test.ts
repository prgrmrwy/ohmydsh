import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decorateSubmit, restoreAllSubmits, restoreSubmit } from '../src/client/handoff.js'
import { getStage, resetStage, setStage } from '../src/client/stage-store.js'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}

interface InputState {
  draft: string
  imageIds: string[]
  phase: 'plain' | 'claimed' | 'submitting'
  occurrences: unknown[]
  claim?: { token: string }
}

function input(initial: Partial<InputState> = {}) {
  let state: InputState = { draft: 'do work', imageIds: [], phase: 'plain', occurrences: [], ...initial }
  const calls: string[] = []
  return {
    calls,
    state: { getSnapshot: () => state, subscribe: () => () => {}, update: () => {}, set: (next: InputState) => { state = next } },
    setDraft(text: string) { calls.push(`draft:${text}`); state = { ...state, draft: text } },
    addImages(ids: readonly string[]) { calls.push(`add:${ids.join(',')}`); state = { ...state, imageIds: [...state.imageIds, ...ids] }; return true },
    removeImage(id: string) { calls.push(`remove:${id}`); state = { ...state, imageIds: state.imageIds.filter(value => value !== id) } },
    pruneImages() {}, beginCommand() { return false }, insertReference() { return false },
    submit(mode?: string) { calls.push(`submit:${mode ?? 'queue'}`) },
    notify(level: string, text: string) { calls.push(`notify:${level}:${text}`) },
  }
}

function harness(source = input(), target = input({ draft: '' })) {
  const sourceId = 'source'
  const targetId = 'target'
  let targetBlank = true
  const listListeners = new Set<() => void>()
  const summaries: Record<string, { blank: boolean; cwd: string }> = {
    [sourceId]: { blank: true, cwd: '/repo' },
    [targetId]: { blank: true, cwd: '/repo/.worktrees/task' },
  }
  const facades = new Map<unknown, unknown>([[sourceId, source], [targetId, target]])
  const opened: string[] = []
  const ctx = {
    conversation: {
      input: { for(scope: { id: string }) { return facades.get(scope.id) } },
      draftImages(ids: readonly string[]) { return ids.map(id => ({ id })) },
    },
    sessions: {
      scope(id: string) { return { id } },
      open(id: string) { opened.push(id) },
      list: {
        getSnapshot() { summaries[targetId]!.blank = targetBlank; return { byId: summaries } },
        subscribe(listener: () => void) { listListeners.add(listener); return () => { listListeners.delete(listener) } },
      },
    },
    workspaces: {
      async create() { return { workspaceId: 'workspace' } },
      async connectWorkspace() { return targetId },
    },
  }
  return {
    ctx: ctx as never, source, target, opened,
    admit() { targetBlank = false; for (const listener of listListeners) listener() },
    setTargetNonblank() { targetBlank = false },
  }
}

function okFetch(): ReturnType<typeof vi.fn> {
  let claimed = false
  return vi.fn(async (url: string, init?: { body?: string }) => ({
    ok: true,
    json: async () => {
      if (url.endsWith('/start')) return { ok: true, data: { operationId: 'operation-client-1', phase: 'prepared', worktreePath: '/repo/.worktrees/task', taskBranch: 'ws/task', baseCommit: 'abc', dependencyMode: 'lean', lockFingerprint: 'fp', dshHome: '/repo/.git/ws/home' } }
      const request = JSON.parse(init?.body ?? '{}') as { action?: string }
      if (request.action === 'claim-submit') { const submitAllowed = !claimed; claimed = true; return { ok: true, data: { state: 'submit-claimed', targetSessionId: 'target', submitAllowed } } }
      return { ok: true, data: { state: request.action === 'admitted' ? 'admitted' : request.action === 'uncertain' ? 'uncertain' : 'target-bound', targetSessionId: 'target', submitAllowed: false } }
    },
  }))
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'operation-client-1' } })
})
afterEach(() => {
  restoreAllSubmits()
  resetStage('source'); resetStage('session-a'); resetStage('session-b')
  vi.restoreAllMocks()
})

describe('client stage store', () => {
  it('defaults Worktree off and resets when cwd changes', () => {
    expect(getStage('session-a', '/repo-a').enabled).toBe(false)
    setStage('session-a', '/repo-a', { enabled: true, baseRef: 'main' })
    expect(getStage('session-a', '/repo-a').enabled).toBe(true)
    expect(getStage('session-a', '/repo-b').enabled).toBe(false)
  })

  it('base and toggle staging has no external side effects', () => {
    let calls = 0
    const stage = setStage('session-b', '/repo', { enabled: true, baseRef: 'origin/main' })
    expect(stage.baseRef).toBe('origin/main')
    expect(calls).toBe(0)
  })
})

describe('submit handoff', () => {
  it('leaves the original submit untouched while disabled and restores on disarm', () => {
    const h = harness()
    const original = h.source.submit
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    expect(h.source.calls).toContain('submit:queue')
    restoreSubmit('source')
    expect(h.source.submit).toBe(original)
  })

  it('single-flights Enter/send paths, transfers text/images, and clears only after admission', async () => {
    const source = input({ draft: 'hello', imageIds: ['image-1'] })
    const h = harness(source)
    globalThis.fetch = okFetch() as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit('queue'); h.source.submit('queue')
    await vi.waitFor(() => expect(h.target.calls).toContain('submit:queue'))
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
    expect(h.source.state.getSnapshot().draft).toBe('hello')
    h.admit()
    await vi.waitFor(() => expect(h.source.state.getSnapshot().draft).toBe(''))
    expect(h.target.calls).toEqual(expect.arrayContaining(['add:image-1', 'draft:hello', 'submit:queue']))
    expect(h.source.calls).toContain('remove:image-1')
    expect(h.opened).toContain('target')
  })

  it.each([
    [{ phase: 'claimed' as const, claim: { token: '/plan' } }, /plain input/],
    [{ occurrences: [{}] }, /Remove @ references/],
    [{ draft: '', imageIds: [] }, /Enter a task/],
  ])('refuses unsafe input before Host side effects', async (state, expected) => {
    const h = harness(input(state))
    globalThis.fetch = okFetch() as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(h.source.calls.some(call => call.startsWith('notify:error:'))).toBe(true))
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(getStage('source', '/repo').error).toMatch(expected)
  })

  it('preserves the source and Worktree state when Host start fails', async () => {
    const h = harness(input({ draft: 'retry me' }))
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({ ok: false, error: { code: 'GIT_FAILED', message: 'boom', retryable: true } }) })) as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('error'))
    expect(h.source.state.getSnapshot().draft).toBe('retry me')
    expect(getStage('source', '/repo').enabled).toBe(true)
  })

  it('uses the Host durable claim to prevent resubmit after local storage loss', async () => {
    const h = harness()
    let claimed = false
    globalThis.fetch = vi.fn(async (url: string, init?: { body?: string }) => ({ ok: true, json: async () => {
      if (url.endsWith('/start')) return { ok: true, data: { operationId: 'operation-client-1', phase: 'prepared', worktreePath: '/repo/.worktrees/task', taskBranch: 'ws/task', baseCommit: 'abc', dependencyMode: 'lean', lockFingerprint: 'fp', dshHome: '/repo/.git/ws/home' } }
      const body = JSON.parse(init?.body ?? '{}') as { action?: string }
      if (body.action === 'claim-submit') { const submitAllowed = !claimed; claimed = true; return { ok: true, data: { state: 'submit-claimed', targetSessionId: 'target', submitAllowed } } }
      return { ok: true, data: { state: 'target-bound', targetSessionId: 'target', submitAllowed: false } }
    } })) as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(h.target.calls).toContain('submit:queue'))
    restoreSubmit('source'); resetStage('source')
    h.target.calls.length = 0
    setStage('source', '/repo', { enabled: true, baseRef: 'main', operationId: 'operation-client-1' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('uncertain'))
    expect(h.target.calls.some(call => call.startsWith('submit:'))).toBe(false)
  })

  it('never resubmits an already nonblank target on retry', async () => {
    const h = harness()
    h.setTargetNonblank()
    globalThis.fetch = okFetch() as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main', operationId: 'operation-client-1' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('done'))
    expect(h.target.calls.some(call => call.startsWith('submit:'))).toBe(false)
    expect(h.opened).toEqual(['target'])
  })
})
