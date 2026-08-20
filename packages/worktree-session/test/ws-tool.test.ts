import { describe, expect, it } from 'vitest'
import { targetFor } from '../src/host/tool.js'

describe('Session-oriented ws tool target', () => {
  it('uses the calling Session identity, never the Agent identity', () => {
    expect(targetFor({}, {
      agent: {
        session: { id: 'session-source', header: { cwd: '/repo' } },
      },
    })).toEqual({ sessionId: 'session-source', repoPath: '/repo' })
  })

  it('retains host/CLI operator recovery paths but rejects Agent cross-binding paths', () => {
    expect(targetFor({ path: '/repo/.worktrees/operator-recovery' }, {})).toBe('/repo/.worktrees/operator-recovery')
    expect(() => targetFor({ path: '/repo/.worktrees/other' }, { agent: { session: { id: 'session-source', header: { cwd: '/repo' } } } })).toThrow(/Agent-bound call/)
    expect(() => targetFor({}, {})).toThrow(/calling Session binding/)
  })
})
