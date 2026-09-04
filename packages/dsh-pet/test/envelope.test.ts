/**
 * Invocation envelope rendering.
 */

import { describe, expect, it } from 'vitest'
import { renderEnvelope } from '../src/host/envelope.js'


describe('the executor is told to answer in Chinese', () => {
  it('states the language requirement in the envelope', () => {
    const text = renderEnvelope({
      task: { id: 'task-1', epoch: 1 } as never,
      invocation: { id: 'inv-1', capabilityId: 'demo', skillName: 'demo' } as never,
      snapshot: { id: 'snap-1', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
    })

    // Repeated per Invocation, not only in the standing instructions: a long
    // session can drift away from a briefing it saw once at the start.
    expect(text).toContain('用中文回复')
  })

  it('states it in the standing instructions too', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const instructions = await readFile(
      nodePath.resolve(process.cwd(), 'executor-instructions.md'),
      'utf8',
    )

    expect(instructions).toContain('用中文回复')
    // Code and paths must survive verbatim; translating them would break them.
    expect(instructions).toContain('不要翻译')
  })

  it('leaves the skill token untranslated', () => {
    const text = renderEnvelope({
      task: { id: 'task-1', epoch: 1 } as never,
      invocation: { id: 'inv-1', capabilityId: 'create-mr', skillName: 'create-mr' } as never,
      snapshot: { id: 'snap-1', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
    })

    // The leading token drives real Skill injection; it is an identifier.
    expect(text.startsWith('/create-mr')).toBe(true)
  })
})

describe('configured arguments ride on the skill token', () => {
  it('appends them after the skill name, as a user would type', () => {
    const text = renderEnvelope({
      task: { id: 't', epoch: 1 } as never,
      invocation: { id: 'i', capabilityId: 'ws', skillName: 'ws' } as never,
      snapshot: { id: 's', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
      skillArguments: 'clean',
    })

    // This line drives real Skill injection, so the arguments must be on it —
    // a separate section would leave the Skill invoked with no argument at all.
    expect(text.split('\n')[0]).toBe('/ws clean')
  })

  it('leaves the token bare when nothing is configured', () => {
    const text = renderEnvelope({
      task: { id: 't', epoch: 1 } as never,
      invocation: { id: 'i', capabilityId: 'ws', skillName: 'ws' } as never,
      snapshot: { id: 's', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
    })

    expect(text.split('\n')[0]).toBe('/ws')
  })

  it('treats whitespace-only arguments as none', () => {
    const text = renderEnvelope({
      task: { id: 't', epoch: 1 } as never,
      invocation: { id: 'i', capabilityId: 'ws', skillName: 'ws' } as never,
      snapshot: { id: 's', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
      skillArguments: '   ',
    })

    // A trailing space would change the injected command text.
    expect(text.split('\n')[0]).toBe('/ws')
  })

  it('passes arbitrary text through unparsed', () => {
    const text = renderEnvelope({
      task: { id: 't', epoch: 1 } as never,
      invocation: { id: 'i', capabilityId: 'demo', skillName: 'demo' } as never,
      snapshot: { id: 's', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
      skillArguments: '--dry-run /a/b c "quoted"',
    })

    // Pet does not interpret arguments; the Skill's instructions do.
    expect(text.split('\n')[0]).toBe('/demo --dry-run /a/b c "quoted"')
  })
})

describe('the two sessions are described as independent facts', () => {
  const envelope = (availability: string, isFirst = true) => renderEnvelope({
    task: { id: 'task-1', epoch: 1, sourceId: 'session-src', sourceAvailability: availability } as never,
    invocation: { id: 'inv-1', capabilityId: 'ws', skillName: 'ws' } as never,
    snapshot: {
      id: 'snap-1', sourceKind: 'session', capturedAt: 1, sessionTitle: '测试会话',
      cwd: '/repo', worktree: { executionRoot: '/repo/.worktrees/task-x', branch: 'ws/task-x' },
    } as never,
    isFirst,
  })

  // An executor that cannot see the source session's state substitutes a
  // guess. Observed twice in practice: it refused to finish a source
  // session's worktree believing that session was still live and driving the
  // task, when the source had already ended.
  it('states the source session availability outright', () => {
    expect(envelope('available')).toContain('来源会话（`session-src`）当前状态：未归档')
    expect(envelope('archived')).toContain('当前状态：已归档')
    expect(envelope('missing')).toContain('当前状态：已不存在于注册表')
  })

  // The lifecycle sentence describes THIS executor. Read as the source
  // session, it becomes "the source keeps driving me" — which is exactly the
  // false premise behind the refusals above.
  it('scopes the multi-invocation lifecycle to the executor session', () => {
    const text = envelope('available')
    expect(text).toContain('你所在的这个 Pet 执行会话')
    expect(text).toMatch(/与来源会话是否仍在运行无关/)
  })

  // Facts, not instructions: the envelope must not tell the capability's
  // gates what to conclude.
  it('states availability without prescribing an action', () => {
    const text = envelope('available')
    expect(text).not.toMatch(/可以(直接)?(清理|归档|删除)/)
    expect(text).not.toMatch(/应当|必须先/)
  })

  it('omits source availability for sourceless tasks', () => {
    const text = renderEnvelope({
      task: { id: 'task-1', epoch: 1, sourceAvailability: 'available' } as never,
      invocation: { id: 'inv-1', capabilityId: 'demo', skillName: 'demo' } as never,
      snapshot: { id: 'snap-1', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
    })
    expect(text).not.toContain('来源会话（')
    expect(text).toContain('独立任务')
  })
})
