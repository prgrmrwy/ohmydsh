import { describe, expect, it, vi } from 'vitest'
import { authorizeExplicitPath } from '../src/host/tool.js'

/**
 * The confirmation runs on `ctx.userQuestions`, NOT `ctx.approval`.
 *
 * That distinction is the whole point of these tests. `ctx.approval` governs
 * sandbox escalation, and a `danger-full-access` deployment pins its policy to
 * `never`, which auto-rejects every request without ever reaching a human.
 * Routing a human decision through it would make the question unanswerable in
 * exactly the deployment that runs this tool. `ctx.userQuestions` is the
 * ask-a-human capability and carries no permission-policy coupling, so the
 * prompt still reaches the user under full access.
 */

const exec = {
  agent: { session: { id: 'session-caller' } },
  callId: 'call-1',
}

describe('explicit-path confirmation is routed to the human, not the permission seam', () => {
  it('asks through userQuestions and never touches the approval seam', async () => {
    const ask = vi.fn(async () => ({ answers: [{ id: 'ws-confirm', selected: ['确认执行'] }] }))
    const approvalRequest = vi.fn()
    const ctx = {
      get: (name: string) => {
        if (name === 'userQuestions') return { ask }
        if (name === 'approval') return { request: approvalRequest }
        return undefined
      },
    }

    await expect(authorizeExplicitPath(ctx, exec, { action: 'clean', path: '/repo/main' }))
      .resolves.toBe('/repo/main')
    expect(ask).toHaveBeenCalledTimes(1)
    // The permission seam must stay untouched: it would auto-reject under
    // danger-full-access and is the wrong capability for a human decision.
    expect(approvalRequest).not.toHaveBeenCalled()
  })

  it('presents the exact action, path and single-use scope', async () => {
    const ask = vi.fn(async () => ({ answers: [{ id: 'ws-confirm', selected: ['取消'] }] }))
    await expect(authorizeExplicitPath({ get: () => ({ ask }) }, exec, { action: 'promote', path: '/repo/.worktrees/task' }))
      .rejects.toThrow(/not authorized by the user/)

    const request = ask.mock.calls[0]![0] as {
      questions: { id: string; question: string; detail?: string; options?: { label: string }[] }[]
      agent?: unknown
    }
    const item = request.questions[0]!
    expect(item.question).toContain('promote')
    // Everything the user must read lives in `question`. The `detail` slot is
    // deliberately unused: the current questions UI gives it a 2px horizontal
    // margin, rendering those lines flush against the panel edge.
    expect(item.detail).toBeUndefined()
    expect(item.question).toContain('/repo/.worktrees/task')
    expect(item.question).toMatch(/仅授权本次调用/)
    // A refusal must be selectable, never only expressible as free text.
    expect(item.options?.map(option => option.label)).toContain('取消')
    // The live agent is forwarded so the question reaches its owning session.
    expect(request.agent).toBe(exec.agent)
  })

  it('fails closed when declined, unanswered, absent or throwing', async () => {
    const declined = { get: () => ({ ask: async () => ({ answers: [{ id: 'ws-confirm', selected: ['取消'] }] }) }) }
    const unanswered = { get: () => ({ ask: async () => ({ answers: [] }) }) }
    const otherQuestion = { get: () => ({ ask: async () => ({ answers: [{ id: 'unrelated', selected: ['确认执行'] }] }) }) }
    const throwing = { get: () => ({ ask: async () => { throw new Error('aborted') } }) }
    const absent = { get: () => undefined }

    for (const ctx of [declined, unanswered, otherQuestion, throwing, absent, {}]) {
      await expect(authorizeExplicitPath(ctx, exec, { action: 'clean', path: '/repo/main' }))
        .rejects.toThrow(/not authorized by the user/)
    }
  })

  it('treats free text alone as a refusal', async () => {
    // Typing something without selecting the affirmative option is not consent.
    const ask = async () => ({ answers: [{ id: 'ws-confirm', selected: [], custom: 'maybe later' }] })
    await expect(authorizeExplicitPath({ get: () => ({ ask }) }, exec, { action: 'clean', path: '/repo/main' }))
      .rejects.toThrow(/not authorized by the user/)
  })
})
