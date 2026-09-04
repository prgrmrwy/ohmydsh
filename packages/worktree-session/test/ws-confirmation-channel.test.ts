import { describe, expect, it, vi } from 'vitest'
import { authorizeExplicitPath, sessionLabel } from '../src/host/tool.js'

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

    // A human saw the question and did not agree: their decision.
    for (const ctx of [declined, unanswered, otherQuestion]) {
      await expect(authorizeExplicitPath(ctx, exec, { action: 'clean', path: '/repo/main' }))
        .rejects.toThrow(/not authorized by the user/)
    }
    // The question never reached anyone. Still fails closed, but reporting it
    // as a user refusal would attribute a decision nobody made, and would hide
    // the only actionable fact: this caller has no answerer.
    for (const ctx of [throwing, absent, {}]) {
      await expect(authorizeExplicitPath(ctx, exec, { action: 'clean', path: '/repo/main' }))
        .rejects.toThrow(/did not reach a human/)
    }
  })

  it('treats free text alone as a refusal', async () => {
    // Typing something without selecting the affirmative option is not consent.
    const ask = async () => ({ answers: [{ id: 'ws-confirm', selected: [], custom: 'maybe later' }] })
    await expect(authorizeExplicitPath({ get: () => ({ ask }) }, exec, { action: 'clean', path: '/repo/main' }))
      .rejects.toThrow(/not authorized by the user/)
  })
})

describe('the confirmation names the session the way a human knows it', () => {
  // A bare `session-6456e0ce-6ded-47ba-9c79-...` identifies nothing to the
  // person deciding; the title is what tells two sessions apart.
  it('labels a titled session as title plus short id', () => {
    expect(sessionLabel('session-6456e0ce-6ded-47ba-9c79-ac02cf871eb3', '简单测试消息，无具体任务'))
      .toBe('简单测试消息，无具体任务（6456e0）')
  })

  // Titles are neither unique nor guaranteed, so the id stays as the
  // tiebreaker rather than being dropped for prettiness.
  it('still identifies a session that has no title', () => {
    expect(sessionLabel('session-dfc5c3d3-7b85-4500-95ac-ff35905b8c73')).toBe('未命名会话（dfc5c3）')
    expect(sessionLabel('session-dfc5c3d3-7b85-4500-95ac-ff35905b8c73', '   ')).toBe('未命名会话（dfc5c3）')
  })

  // Ids that do not carry the usual prefix must still shorten predictably.
  it('shortens an id without the session- prefix', () => {
    expect(sessionLabel('abcdef0123456789', 'x')).toBe('x（abcdef）')
  })

  it('asks about the worktree by name and identifies the session by title', async () => {
    const ask = vi.fn(async () => ({ answers: [{ id: 'ws-confirm', selected: ['取消'] }] }))
    const ctx = {
      get: (name: string) => name === 'userQuestions' ? { ask } : undefined,
      sessions: {
        get: () => ({ events: [{ type: 'session/title', data: { title: '简单测试消息，无具体任务' } }] }),
      },
      workspaceRegistry: { archivedSessionIds: [], archiveSession: async () => {} },
    }
    const { confirmArchiveDetailFor } = await import('../src/host/tool.js')
    const text = confirmArchiveDetailFor(ctx as never, {
      sourceSessionId: 'session-6456e0ce-6ded-47ba-9c79-ac02cf871eb3',
      worktreePath: '/repo/.worktrees/task-6aa8f49cc9',
      taskBranch: 'ws/task-6aa8f49cc9',
    } as never)

    expect(text).toContain('task-6aa8f49cc9')
    expect(text).toContain('简单测试消息，无具体任务（6456e0）')
    // The undecipherable full id must not be what the human is asked about.
    expect(text).not.toContain('session-6456e0ce-6ded-47ba-9c79-ac02cf871eb3')
    // The exact path stays available for the reader who needs it.
    expect(text).toContain('/repo/.worktrees/task-6aa8f49cc9')
  })
})
