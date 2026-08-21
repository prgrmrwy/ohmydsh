import { beforeEach, describe, expect, it, vi } from 'vitest'

const values = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value) },
  removeItem: (key: string) => { values.delete(key) },
})

import { getStage, resetStage, resetStageForCwd, setStage } from '../src/client/stage-store.js'

beforeEach(() => { values.clear(); resetStage('session-a') })

describe('authoritative unbound stage reset', () => {
  it('clears stale cleaned state for the exact Session/cwd', () => {
    setStage('session-a', '/repo', { lifecycle: 'cleaned', taskBranch: 'ws/done', enabled: true })
    expect(resetStageForCwd('session-a', '/repo')).toBe(true)
    expect(getStage('session-a', '/repo')).toMatchObject({ enabled: false, phase: 'idle' })
    expect(getStage('session-a', '/repo').lifecycle).toBeUndefined()
    expect(values.has('dsh.worktree-session.v1.session-a')).toBe(false)
  })

  it('does not clear another cwd persisted under the same Session id', () => {
    setStage('session-a', '/other', { lifecycle: 'cleaned', taskBranch: 'ws/other' })
    expect(resetStageForCwd('session-a', '/repo')).toBe(false)
    expect(getStage('session-a', '/other').lifecycle).toBe('cleaned')
  })
})
