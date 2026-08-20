import { describe, expect, it } from 'vitest'
import { targetFor, WS_TOOL_PARAMETERS } from '../src/host/tool.js'

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

  it('tolerates clients that encode an omitted optional path as an empty string', () => {
    expect(targetFor({ path: '' }, {
      agent: {
        session: { id: 'session-source', header: { cwd: '/repo' } },
      },
    })).toEqual({ sessionId: 'session-source', repoPath: '/repo' })
    expect(() => targetFor({ path: '' }, {})).toThrow(/calling Session binding/)
  })

  it('does not advertise the operator-only path on the model-visible tool', () => {
    expect(WS_TOOL_PARAMETERS).toHaveProperty('action')
    expect(WS_TOOL_PARAMETERS).toHaveProperty('dry_run')
    expect(WS_TOOL_PARAMETERS).not.toHaveProperty('path')
  })
})
