import { describe, expect, it } from 'vitest'
import { activeBindingContext, boundContextText, cleanedBindingContext } from '../src/host/context.js'
import { bindingOf, type OperationRecord } from '../src/wire.js'

function operation(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    schemaVersion: 2,
    operationId: 'operation-12345678',
    repoRoot: '/repo',
    gitCommonDir: '/repo/.git',
    baseRef: 'main',
    baseCommit: 'abc',
    taskBranch: 'ws/task',
    worktreePath: '/repo/.worktrees/task',
    taskHash: 'hash',
    dependencyMode: 'lean',
    dshHome: '/repo/.git/ws/home/operation-12345678',
    phase: 'prepared',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('Worktree Session stable runtime context', () => {
  it('is byte-identical across repeated renders for the same active binding', () => {
    const record = operation({ binding: { mode: 'source-session', sourceSessionId: 'session-a', state: 'admitted', updatedAt: '2026-01-01T00:00:00.000Z' } })
    const binding = bindingOf(record)
    const first = activeBindingContext(record)
    expect(boundContextText(record, binding)).toBe(first)
    expect(activeBindingContext(record)).toBe(first)
    // No dynamic fields leak into the active context.
    expect(first).toContain('/repo/.worktrees/task')
    expect(first).toContain('ws/task')
    expect(first).toContain('不要再用 pwd、目录枚举或 ws status 例行确认')
    expect(first).toContain('无 path 的 ws status')
    expect(first).not.toContain('updatedAt')
    expect(first).not.toContain('2026-')
    expect(first).not.toContain('lean')
    expect(first).not.toContain('mutable')
    expect(first).not.toContain('prepared')
  })

  it('stays byte-identical across a lean -> mutable transition', () => {
    const record = operation({ dependencyMode: 'lean', binding: { mode: 'source-session', sourceSessionId: 'session-a', state: 'admitted', updatedAt: '2026-01-01T00:00:00.000Z' } })
    const binding = bindingOf(record)
    const before = activeBindingContext(record)
    const mutable = operation({ dependencyMode: 'mutable', binding: { mode: 'source-session', sourceSessionId: 'session-a', state: 'admitted', updatedAt: '2026-01-02T00:00:00.000Z' } })
    expect(activeBindingContext(mutable)).toBe(before)
    // boundContextText is also stable across the transient mode change.
    expect(boundContextText(mutable, bindingOf(mutable))).toBe(before)
  })

  it('returns undefined when no source-session binding exists', () => {
    const unbound = operation({ binding: undefined })
    expect(boundContextText(unbound, bindingOf(unbound))).toBeUndefined()
    expect(boundContextText(undefined, undefined)).toBeUndefined()
  })

  it('renders a deterministic cleaned terminal context distinct from active', () => {
    const cleaned = operation({ binding: { mode: 'source-session', sourceSessionId: 'session-c', state: 'cleaned', updatedAt: '2026-01-03T00:00:00.000Z' } })
    const binding = bindingOf(cleaned)
    const active = activeBindingContext(cleaned)
    const cleanedText = cleanedBindingContext(cleaned)
    expect(boundContextText(cleaned, binding)).toBe(cleanedText)
    expect(cleanedText).toContain('已不存在')
    expect(cleanedText).not.toContain('promote')
    expect(cleanedText).not.toBe(active)
    expect(cleanedText).not.toContain('2026-')
  })

  it('reprojects the same active text after a hypothetical compaction without duplication', () => {
    const record = operation({ binding: { mode: 'source-session', sourceSessionId: 'session-a', state: 'admitted', updatedAt: '2026-01-01T00:00:00.000Z' } })
    const text = boundContextText(record, bindingOf(record))
    // Recomputing for the same operation yields the identical string, so the
    // runtime-context projection will not emit a new snapshot.
    expect(boundContextText(record, bindingOf(record))).toBe(text)
  })
})
