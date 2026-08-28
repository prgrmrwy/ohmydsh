import { describe, expect, it } from 'vitest'
import { cleanTargetFor, targetFor, WS_TOOL_PARAMETERS } from '../src/host/tool.js'

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

describe('repository-oriented ws clean target', () => {
  const mainSession = { agent: { session: { id: 'session-main', header: { cwd: '/repo' } } } }

  // 1.1 An unbound ordinary main-checkout Session must reach repository cleanup
  // instead of resolving through a caller binding it does not have.
  it('resolves an unbound main-checkout Session to its repository', () => {
    expect(cleanTargetFor(mainSession, { boundSessionIds: [] })).toEqual({ repoPath: '/repo' })
  })

  // 1.2 A Session still bound to a Worktree must not clean itself or scan peers.
  it('refuses a bound Worktree Session and names the ordinary main Session', () => {
    expect(() => cleanTargetFor(mainSession, { boundSessionIds: ['session-main'] }))
      .toThrow(/ordinary main-checkout Session/)
  })

  // 1.3 Cleanup requires a callable Session identity before any scan happens.
  it('refuses a caller without a resolvable Session cwd', () => {
    expect(() => cleanTargetFor({}, { boundSessionIds: [] })).toThrow(/calling Session/)
    expect(() => cleanTargetFor({ agent: { session: { id: 'session-main', header: {} } } }, { boundSessionIds: [] }))
      .toThrow(/calling Session/)
  })
})
