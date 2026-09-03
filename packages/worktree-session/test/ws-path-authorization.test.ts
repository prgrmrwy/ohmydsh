import { describe, expect, it, vi } from 'vitest'
import { authorizeExplicitPath, cleanTargetFor, targetFor, WS_TOOL_PARAMETERS } from '../src/host/tool.js'

/**
 * The explicit-path channel is generic: it is proven with a plain Agent-bound
 * execution and an approval seam, never with any caller-specific fixture.
 * The seam is consumed through `ctx.get('approval')` exactly like the official
 * tool `ask` policy, so a missing service is a fail-closed refusal, not a
 * cordis inject error.
 */
const exec = {
  agent: { session: { id: 'session-caller', header: { cwd: '/pet/workspace' } } },
  callId: 'call-1',
}

/** Build a context double serving one fixed approval outcome via ctx.get. */
function ctxWithApproval(approval: unknown) {
  return { get: (name: string) => (name === 'approval' ? approval : undefined) }
}

/** Build an approval service double returning one fixed outcome. */
function approvalReturning(outcome: string) {
  return { request: vi.fn(async () => outcome) }
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
  it('accepts the explicit path when the user grants one-shot authorization', async () => {
    const approval = approvalReturning('allowed-once')
    await expect(authorizeExplicitPath(ctxWithApproval(approval), exec, { action: 'clean', path: '/repo' }))
      .resolves.toBe('/repo')
    expect(approval.request).toHaveBeenCalledTimes(1)
  })

  // 1.2 Refusal and withdrawal both refuse, before any resource is touched.
  it('refuses a rejected or cancelled authorization', async () => {
    await expect(authorizeExplicitPath(ctxWithApproval(approvalReturning('rejected')), exec, { action: 'clean', path: '/repo' }))
      .rejects.toThrow(/not authorized by the user/)
    await expect(authorizeExplicitPath(ctxWithApproval(approvalReturning('cancelled')), exec, { action: 'clean', path: '/repo' }))
      .rejects.toThrow(/not authorized by the user/)
  })

  // 1.3 Fail closed: an unavailable answerer and an absent service are refusals,
  // never a silent fallback to the caller's own cwd.
  it('fails closed when no answerer is available or the service is absent', async () => {
    await expect(authorizeExplicitPath(ctxWithApproval(approvalReturning('unavailable')), exec, { action: 'clean', path: '/repo' }))
      .rejects.toThrow(/not authorized by the user/)
    await expect(authorizeExplicitPath({}, exec, { action: 'clean', path: '/repo' }))
      .rejects.toThrow(/not authorized by the user/)
    await expect(authorizeExplicitPath({ get: () => undefined }, exec, { action: 'clean', path: '/repo' }))
      .rejects.toThrow(/not authorized by the user/)
  })

  // 1.3 A throwing service (e.g. no open turn) must not degrade into a grant.
  it('fails closed when the approval service throws', async () => {
    const approval = { request: vi.fn(async () => { throw new Error('no turn open') }) }
    await expect(authorizeExplicitPath(ctxWithApproval(approval), exec, { action: 'clean', path: '/repo' }))
      .rejects.toThrow(/not authorized by the user/)
  })

  // 2.3 The question must carry the exact action and path so the user can judge
  // it, and must stay caller-agnostic.
  it('asks with the exact action and path, bound to this tool call', async () => {
    const approval = approvalReturning('allowed-once')
    await authorizeExplicitPath(ctxWithApproval(approval), exec, { action: 'promote', path: '/repo/.worktrees/task' })
    const request = approval.request.mock.calls[0]![0] as { toolName: string; callId: string; reason: string; agent: unknown }
    expect(request.toolName).toBe('ws')
    expect(request.callId).toBe('call-1')
    expect(request.agent).toBe(exec.agent)
    expect(request.reason).toContain('promote')
    expect(request.reason).toContain('/repo/.worktrees/task')
    expect(request.reason).toMatch(/once/i)
  })

  // 1.5 Authorization is single-use: a second call asks again.
  it('asks again for every subsequent explicit-path call', async () => {
    const approval = approvalReturning('allowed-once')
    const ctx = ctxWithApproval(approval)
    await authorizeExplicitPath(ctx, exec, { action: 'status', path: '/repo/.worktrees/task' })
    await authorizeExplicitPath(ctx, exec, { action: 'status', path: '/repo/.worktrees/task' })
    expect(approval.request).toHaveBeenCalledTimes(2)
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

  // Operator (non-Agent) explicit paths keep working with no authorization.
  it('keeps the operator explicit-path entry unauthenticated', () => {
    expect(targetFor({ path: '/repo/.worktrees/operator' }, {})).toBe('/repo/.worktrees/operator')
  })

  // 3.4 A bound Worktree Session without an authorized path is still refused.
  it('still refuses a bound Session that supplies no explicit path', () => {
    expect(() => cleanTargetFor(exec, { boundSessionIds: ['session-caller'] }))
      .toThrow(/ordinary main-checkout Session/)
  })
})