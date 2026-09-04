import { describe, expect, it, vi } from 'vitest'
import { authorizeExplicitPath, cleanTargetFor, targetFor, WS_TOOL_PARAMETERS } from '../src/host/tool.js'

/**
 * The explicit-path channel is generic: it is proven with a plain Agent-bound
 * execution and a user-questions seam, never with any caller-specific fixture.
 * How that seam behaves under a full-access deployment is covered separately
 * in `ws-confirmation-channel.test.ts`.
 */
const exec = {
  agent: { session: { id: 'session-caller', header: { cwd: '/pet/workspace' } } },
  callId: 'call-1',
}

/** Context double serving one fixed answer through ctx.get('userQuestions'). */
function ctxAnswering(selected: string[]) {
  const ask = vi.fn(async () => ({ answers: [{ id: 'ws-confirm', selected }] }))
  return { ctx: { get: (name: string) => (name === 'userQuestions' ? { ask } : undefined) }, ask }
}

describe('explicit ws path is model-visible', () => {
  // 2.1a The channel must be discoverable in the schema, not rely on the
  // undocumented open parameter root.
  it('declares an optional path parameter describing one-shot authorization', () => {
    expect(WS_TOOL_PARAMETERS).toHaveProperty('path')
    const path = (WS_TOOL_PARAMETERS as { path: { type: string; required?: boolean; description: string } }).path
    expect(path.type).toBe('string')
    expect(path.required).not.toBe(true)
    expect(path.description).toMatch(/authoriz/i)
  })
})

describe('explicit ws path authorization', () => {
  // 1.1 A granted path becomes the trusted target source for this call.
  it('accepts the explicit path when the user agrees', async () => {
    const { ctx, ask } = ctxAnswering(['确认执行'])
    await expect(authorizeExplicitPath(ctx, exec, { action: 'clean', path: '/repo' }))
      .resolves.toBe('/repo')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  // 1.2 Declining refuses before any resource is touched.
  it('refuses a declined confirmation', async () => {
    const { ctx } = ctxAnswering(['取消'])
    await expect(authorizeExplicitPath(ctx, exec, { action: 'clean', path: '/repo' }))
      .rejects.toThrow(/not authorized by the user/)
  })

  // 1.3 Fail closed: an absent provider is a refusal, never a silent fallback
  // to the caller's own cwd.
  it('fails closed when no questions provider is composed', async () => {
    await expect(authorizeExplicitPath({}, exec, { action: 'clean', path: '/repo' }))
      .rejects.toThrow(/not authorized by the user/)
    await expect(authorizeExplicitPath({ get: () => undefined }, exec, { action: 'clean', path: '/repo' }))
      .rejects.toThrow(/not authorized by the user/)
  })

  // 1.5 Authorization is single-use: a second call asks again.
  it('asks again for every subsequent explicit-path call', async () => {
    const { ctx, ask } = ctxAnswering(['确认执行'])
    await authorizeExplicitPath(ctx, exec, { action: 'status', path: '/repo/.worktrees/task' })
    await authorizeExplicitPath(ctx, exec, { action: 'status', path: '/repo/.worktrees/task' })
    expect(ask).toHaveBeenCalledTimes(2)
  })
})

describe('default resolution is untouched by the authorization channel', () => {
  // 1.4 An omitted or empty path must never trigger a question, and must keep
  // the exact pre-existing resolution and diagnostics.
  it('never asks for an omitted or empty path', () => {
    expect(targetFor({}, exec)).toEqual({ sessionId: 'session-caller', repoPath: '/pet/workspace' })
    expect(targetFor({ path: '' }, exec)).toEqual({ sessionId: 'session-caller', repoPath: '/pet/workspace' })
    expect(cleanTargetFor(exec, { boundSessionIds: [] })).toEqual({ repoPath: '/pet/workspace' })
  })

  // Operator (non-Agent) explicit paths keep working with no confirmation.
  it('keeps the operator explicit-path entry unauthenticated', () => {
    expect(targetFor({ path: '/repo/.worktrees/operator' }, {})).toBe('/repo/.worktrees/operator')
  })

  // 3.4 A bound Worktree Session without an authorized path is still refused.
  it('still refuses a bound Session that supplies no explicit path', () => {
    expect(() => cleanTargetFor(exec, { boundSessionIds: ['session-caller'] }))
      .toThrow(/ordinary main-checkout Session/)
  })
})
