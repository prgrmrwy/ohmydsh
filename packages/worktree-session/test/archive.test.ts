import { describe, expect, it, vi } from 'vitest'
import { workspaceDomainState } from '@deepseek-ai/dsh-workspace'

vi.mock('../src/host/git.js', () => ({ discoverRepo: vi.fn(async () => ({ repoRoot: '/repo', gitCommonDir: '/repo/.git' })) }))
const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(async () => undefined),
  current: vi.fn(async () => undefined),
}))
vi.mock('../src/host/operation.js', () => ({
  reconcileSourceArchiveLifecycle: mocks.reconcile,
  findBySourceSession: mocks.current,
}))
const reconcile = mocks.reconcile

import { registerArchiveLifecycle } from '../src/host/archive.js'

function harness(initial: string[] = []) {
  let listener: ((change: unknown) => void) | undefined
  const recordBind = vi.fn()
  const ctx = {
    sessions: { get: (id: string) => id === 'session-a' ? { header: { cwd: '/repo' } } : undefined },
    workspaceRegistry: {
      archivedSessionIds: initial,
      list: () => [{ path: '/repo', sessionIds: ['session-a'] }],
    },
    logger: { warn: vi.fn() },
    on: (_name: string, fn: (change: unknown) => void) => { listener = fn; return () => {} },
  }
  registerArchiveLifecycle(ctx as never, { recordBind })
  return { listener: (change: unknown) => listener?.(change), recordBind }
}

function state(ids: string[]) {
  return workspaceDomainState.parse({ initialized: true, workspaceIds: [], archivedSessionIds: ids })
}

async function flush(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 0)) }

describe('Workspace archive lifecycle observer', () => {
  it('seeds snapshot, ignores unrelated events, and processes archive/unarchive edges in order', async () => {
    reconcile.mockClear()
    const h = harness([])
    await flush()
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ sourceSessionId: 'session-a', archived: false, mode: 'current-snapshot' }))
    reconcile.mockClear()
    h.listener({ domain: 'other', table: '', key: '', operation: 'put', value: state(['session-a']) })
    h.listener({ domain: 'workspace', table: 'workspaces', key: 'x', operation: 'put', value: {} })
    await flush()
    expect(reconcile).not.toHaveBeenCalled()
    h.listener({ domain: 'workspace', table: '', key: '', operation: 'put', value: state(['session-a']) })
    h.listener({ domain: 'workspace', table: '', key: '', operation: 'put', value: state([]) })
    await flush()
    expect(reconcile.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ archived: true, mode: 'archive-observed' }),
      expect.objectContaining({ archived: false, mode: 'unarchive-observed' }),
    ])
  })
})
