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

  it('retains host/CLI operator recovery paths but rejects unauthorized Agent paths', () => {
    expect(targetFor({ path: '/repo/.worktrees/operator-recovery' }, {})).toBe('/repo/.worktrees/operator-recovery')
    // Without proof of user authorization for this exact path, an Agent-bound
    // explicit path stays refused.
    expect(() => targetFor({ path: '/repo/.worktrees/other' }, { agent: { session: { id: 'session-source', header: { cwd: '/repo' } } } })).toThrow(/one-shot user authorization/)
    // A grant for a DIFFERENT path must not launder this one.
    expect(() => targetFor({ path: '/repo/.worktrees/other' }, { agent: { session: { id: 'session-source', header: { cwd: '/repo' } } } }, '/repo/.worktrees/authorized')).toThrow(/one-shot user authorization/)
    // The exact authorized path resolves as an operator-equivalent target.
    expect(targetFor({ path: '/repo/.worktrees/other' }, { agent: { session: { id: 'session-source', header: { cwd: '/repo' } } } }, '/repo/.worktrees/other')).toBe('/repo/.worktrees/other')
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

  // `path` is declared so the authorization channel is discoverable from the
  // schema rather than reachable only by guessing an undocumented argument
  // (the parameter root is open). Declaring it grants no authority: an
  // Agent-supplied path is refused unless the user authorizes that exact call.
  it('advertises the authorization-gated path on the model-visible tool', () => {
    expect(WS_TOOL_PARAMETERS).toHaveProperty('action')
    expect(WS_TOOL_PARAMETERS).toHaveProperty('dry_run')
    expect(WS_TOOL_PARAMETERS).toHaveProperty('path')
    expect(WS_TOOL_PARAMETERS.path.description).toMatch(/authoriz/i)
    expect(WS_TOOL_PARAMETERS.path).not.toHaveProperty('required')
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
