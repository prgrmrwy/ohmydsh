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
  attachmentIds: string[]
  draftRev: number
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  occurrences: unknown[]
  claim?: { token: string }
  queue: unknown[]
}

function input(initial: Partial<InputState> = {}, options: { submitThrows?: boolean } = {}) {
  let state: InputState = { draft: 'do work', attachmentIds: [], draftRev: 1, phase: 'plain', occurrences: [], queue: [], ...initial }
  const calls: string[] = []
  const originalSubmit = (mode?: string): void => {
    calls.push(`submit:${mode ?? 'queue'}`)
    if (options.submitThrows === true) throw new Error('official submit failed')
    // Model the official SessionInput transaction consuming its own draft.
    state = { ...state, draft: '', attachmentIds: [] }
  }
  const source = {
    calls,
    state: { getSnapshot: () => state, subscribe: () => () => {}, update: () => {}, set: (next: InputState) => { state = next } },
    setDraft(text: string) { calls.push(`draft:${text}`); state = { ...state, draft: text } },
    addAttachments(ids: readonly string[]) { calls.push(`add:${ids.join(',')}`); state = { ...state, attachmentIds: [...state.attachmentIds, ...ids] }; return true },
    removeAttachment(id: string) { calls.push(`remove:${id}`); state = { ...state, attachmentIds: state.attachmentIds.filter(value => value !== id) }; return true },
    pruneAttachments(ids: readonly string[]) { state = { ...state, attachmentIds: state.attachmentIds.filter(id => ids.includes(id)) } },
    beginCommand() { return false },
    insertReference() { return false },
    submit: originalSubmit,
    notify(level: string, text: string) { calls.push(`notify:${level}:${text}`) },
  }
  return source
}

function harness(source = input(), options: { resolved?: string[] } = {}) {
  const sourceId = 'source'
  const facades = new Map<unknown, unknown>([[sourceId, source]])
  const ctx = {
    conversation: {
      input: { for(scope: { id: string }) { return facades.get(scope.id) } },
      resolveDraftAttachments(ids: readonly string[]) { return (options.resolved ?? [...ids]).map(id => ({ id })) },
    },
    sessions: {
      scope(id: string) { return { id } },
    },
  }
  return { ctx: ctx as never, source }
}

function okFetch(options: { startFailure?: boolean; bindFailure?: boolean } = {}): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.endsWith('/start')) {
      if (options.startFailure) return { ok: true, json: async () => ({ ok: false, error: { code: 'GIT_FAILED', message: 'boom', retryable: true } }) }
      return { ok: true, json: async () => ({ ok: true, data: { operationId: 'operation-client-1', phase: 'prepared', worktreePath: '/repo/.worktrees/task', taskBranch: 'ws/task', baseCommit: 'abc', dependencyMode: 'lean', packageManager: 'npm', lockFingerprint: 'fp', dshHome: '/repo/.git/ws/home' } }) }
    }
    if (options.bindFailure) return { ok: true, json: async () => ({ ok: false, error: { code: 'OPERATION_CONFLICT', message: 'bind failed', retryable: true } }) }
    expect(JSON.parse(init?.body ?? '{}')).toMatchObject({ action: 'bind-source' })
    return { ok: true, json: async () => ({ ok: true, data: { state: 'bound', sourceSessionId: 'source' } }) }
  })
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

  it('single-flights duplicate sends, binds in place, and invokes official submit once', async () => {
    const source = input({ draft: 'hello', attachmentIds: ['image-1'] })
    const h = harness(source)
    const fetch = okFetch()
    globalThis.fetch = fetch as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    const restore = decorateSubmit(h.ctx, 'source', '/repo')
    const decorated = h.source.submit
    h.source.submit('queue'); h.source.submit('queue')
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('done'))
    expect(h.source.calls.filter(call => call === 'submit:queue')).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(2) // start, bind-source only
    expect(h.source.state.getSnapshot()).toMatchObject({ draft: '', attachmentIds: [] })
    expect(getStage('source', '/repo')).toMatchObject({ lifecycle: 'bound', taskBranch: 'ws/task', dependencyMode: 'lean', phase: 'done' })
    expect(h.source.submit).not.toBe(decorated)
    restore()
  })

  it('allows an attachment-only draft', async () => {
    const source = input({ draft: '', attachmentIds: ['file-1'] })
    const h = harness(source)
    globalThis.fetch = okFetch() as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit('steer')
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('done'))
    expect(h.source.calls).toContain('submit:steer')
  })

  it.each([
    [{ phase: 'adjudicating' as const }, /plain input/],
    [{ phase: 'claimed' as const, claim: { token: '/plan' } }, /plain input/],
    [{ phase: 'submitting' as const }, /plain input/],
    [{ occurrences: [{}] }, /Remove @ references/],
    [{ draft: '', attachmentIds: [] }, /Enter a task/],
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

  it('rejects stale official draft attachment ids before Host side effects', async () => {
    const source = input({ attachmentIds: ['gone'] })
    const h = harness(source, { resolved: [] })
    globalThis.fetch = okFetch() as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(h.source.calls.some(call => call.startsWith('notify:error:'))).toBe(true))
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(getStage('source', '/repo').error).toMatch(/attachments/)
  })

  it('preserves the official draft and never falls back when Host start fails', async () => {
    const source = input({ draft: 'retry me', attachmentIds: ['img'] })
    const h = harness(source)
    globalThis.fetch = okFetch({ startFailure: true }) as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('error'))
    expect(h.source.state.getSnapshot()).toMatchObject({ draft: 'retry me', attachmentIds: ['img'] })
    expect(h.source.calls.some(call => call.startsWith('submit:'))).toBe(false)
    expect(getStage('source', '/repo')).toMatchObject({ enabled: true, operationId: 'operation-client-1' })
  })

  it('preserves the official draft when bind fails', async () => {
    const source = input({ draft: 'bind retry', attachmentIds: ['img'] })
    const h = harness(source)
    globalThis.fetch = okFetch({ bindFailure: true }) as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('error'))
    expect(h.source.state.getSnapshot()).toMatchObject({ draft: 'bind retry', attachmentIds: ['img'] })
    expect(h.source.calls.some(call => call.startsWith('submit:'))).toBe(false)
  })

  it('notifies and restores only the decoration when official submit throws synchronously', async () => {
    const source = input({ draft: 'keep official', attachmentIds: ['img'] }, { submitThrows: true })
    const h = harness(source)
    const original = source.submit
    globalThis.fetch = okFetch() as never
    setStage('source', '/repo', { enabled: true, baseRef: 'main' })
    decorateSubmit(h.ctx, 'source', '/repo')
    h.source.submit()
    await vi.waitFor(() => expect(getStage('source', '/repo').phase).toBe('error'))
    expect(source.submit).toBe(original)
    expect(source.state.getSnapshot()).toMatchObject({ draft: 'keep official', attachmentIds: ['img'] })
    expect(source.calls).toContain('notify:error:Worktree Session: official submit failed')
    expect(source.calls.some(call => call.startsWith('draft:') || call.startsWith('add:'))).toBe(false)
  })
})
