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
  let onSubmit: (() => void) | undefined
  return {
    calls,
    setOnSubmit(value: () => void) { onSubmit = value },
    state: { getSnapshot: () => state, subscribe: () => () => {}, update: () => {}, set: (next: InputState) => { state = next } },
    setDraft(text: string) { calls.push(`draft:${text}`); state = { ...state, draft: text } },
    addImages(ids: readonly string[]) { calls.push(`add:${ids.join(',')}`); state = { ...state, imageIds: [...state.imageIds, ...ids] }; return true },
    removeImage(id: string) { calls.push(`remove:${id}`); state = { ...state, imageIds: state.imageIds.filter(value => value !== id) } },
    pruneImages() {}, beginCommand() { return false }, insertReference() { return false },
    submit(mode?: string) {
      calls.push(`submit:${mode ?? 'queue'}`)
      // Model the official source submission consuming its admitted draft.
      state = { ...state, draft: '', imageIds: [] }
      onSubmit?.()
    },
    notify(level: string, text: string) { calls.push(`notify:${level}:${text}`) },
  }
}

function harness(source = input()) {
  const sourceId = 'source'
  let sourceBlank = true
  const listListeners = new Set<() => void>()
  const summaries: Record<string, { blank: boolean; cwd: string }> = { [sourceId]: { blank: true, cwd: '/repo' } }
  const facades = new Map<unknown, unknown>([[sourceId, source]])
  const workspacesCreated: string[] = []
  const sessionsOpened: string[] = []
  const ctx = {
    conversation: {
      input: { for(scope: { id: string }) { return facades.get(scope.id) } },
      draftImages(ids: readonly string[]) { return ids.map(id => ({ id })) },
    },
    sessions: {
      scope(id: string) { return { id } },
      open(id: string) { sessionsOpened.push(id) },
      list: {
        getSnapshot() { summaries[sourceId]!.blank = sourceBlank; return { byId: summaries } },
        subscribe(listener: () => void) { listListeners.add(listener); return () => { listListeners.delete(listener) } },
      },
    },
    workspaces: {
      async create() { workspacesCreated.push('created'); return { workspaceId: 'workspace' } },
      async connectWorkspace() { return 'target' },
    },
  }
  return {
    ctx: ctx as never, source, workspacesCreated, sessionsOpened,
    admit() { sourceBlank = false; for (const listener of listListeners) listener() },
    keepBlank() { sourceBlank = true },
    sessionCount() { return Object.keys(summaries).length },
  }
}

function okFetch(options: { claimAlready?: boolean; startFailure?: boolean } = {}): ReturnType<typeof vi.fn> {
  let claimed = options.claimAlready === true
  return vi.fn(async (url: string, init?: { body?: string }) => ({
    ok: true,
    json: async () => {
      if (url.endsWith('/start')) {
        if (options.startFailure) return { ok: false, error: { code: 'GIT_FAILED', message: 'boom', retryable: true } }
        return { ok: true, data: { operationId: 'operation-client-1', phase: 'prepared', worktreePath: '/repo/.worktrees/task', taskBranch: 'ws/task', baseCommit: 'abc', dependencyMode: 'lean', lockFingerprint: 'fp', dshHome: '/repo/.git/ws/home' } }
      }
      const request = JSON.parse(init?.body ?? '{}') as { action?: string }
      if (request.action === 'claim-submit') { const submitAllowed = !claimed; claimed = true; return { ok: true, data: { state: 'submit-claimed', sourceSessionId: 'source', submitAllowed } } }
      return { ok: true, data: { state: request.action === 'admitted' ? 'admitted' : request.action === 'uncertain' ? 'uncertain' : 'bound', sourceSessionId: 'source', submitAllowed: false } }
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
    const stage = setStage('session-b', '/repo', { enabled: true, baseRef: 'origin/main' })
    expect(stage.baseRef).toBe('origin/main')
  })
})

describe('in-place source Session submit', () => {
  it('passes through the exact original submit while disabled and restores on disarm', () => {
    const h = harness()
    const original = h.source.submit
    const untouchedFetch = vi.fn()
    globalThis.fetch = untouchedFetch as never
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    expect(h.source.calls).toContain('submit:queue')
    restoreSubmit('source')
    expect(h.source.submit).toBe(original)
    expect(untouchedFetch).not.toHaveBeenCalled()
  })

  it('single-flights Enter/send, creates no Workspace/Session, and admits once in source Session', async () => {
    const source = input({ draft: 'hello', imageIds: ['image-1'] })
    const h = harness(source)
    source.setOnSubmit(() => h.admit())
    globalThis.fetch = okFetch() as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit('queue'); h.source.submit('queue')
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('done'))
    expect(h.source.calls.filter(call => call === 'submit:queue')).toHaveLength(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(4) // start, bind, claim, admitted
    expect(h.workspacesCreated).toEqual([])
    expect(h.sessionsOpened).toEqual([])
    expect(h.sessionCount()).toBe(1)
    expect(h.source.state.getSnapshot()).toMatchObject({ draft: '', imageIds: [] })
    expect(getStage('source', '/repo')).toMatchObject({ lifecycle: 'admitted', taskBranch: 'ws/task', dependencyMode: 'lean' })
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

  it('preserves source draft/images and never falls back when Host start fails', async () => {
    const source = input({ draft: 'retry me', imageIds: ['img'] })
    const h = harness(source)
    globalThis.fetch = okFetch({ startFailure: true }) as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('error'))
    expect(h.source.state.getSnapshot()).toMatchObject({ draft: 'retry me', imageIds: ['img'] })
    expect(h.source.calls.some(call => call.startsWith('submit:'))).toBe(false)
    expect(getStage('source', '/repo')).toMatchObject({ enabled: true, operationId: 'operation-client-1' })
    expect(h.workspacesCreated).toEqual([])
  })

  it('uses Host durable claim to prevent automatic resubmit after local storage loss', async () => {
    const h = harness()
    globalThis.fetch = okFetch({ claimAlready: true }) as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main', operationId: 'operation-client-1' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('uncertain'))
    expect(h.source.calls.some(call => call.startsWith('submit:'))).toBe(false)
    expect(h.source.state.getSnapshot().draft).toBe('do work')
  })

  it('preserves consumed draft/images when source admission remains uncertain', async () => {
    vi.useFakeTimers()
    const source = input({ draft: 'keep me', imageIds: ['img'] })
    const h = harness(source)
    h.keepBlank()
    globalThis.fetch = okFetch() as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.advanceTimersByTimeAsync(8_100)
    await vi.runAllTicks()
    expect(getStage('source', '/repo').phase).toBe('uncertain')
    expect(h.source.calls.filter(call => call.startsWith('submit:'))).toHaveLength(1)
    expect(h.source.state.getSnapshot()).toMatchObject({ draft: 'keep me', imageIds: ['img'] })
    vi.useRealTimers()
  })
})
