/**
 * Invocation envelope rendering.
 */

import { describe, expect, it } from 'vitest'
import { renderEnvelope } from '../src/host/envelope.js'
describe('configured Skill parameters reach the Agent', () => {
  it('lists them in the envelope', () => {
    const text = renderEnvelope({
      task: { id: 'task-1', epoch: 1 } as never,
      invocation: { id: 'inv-1', capabilityId: 'demo', skillName: 'demo' } as never,
      snapshot: {
        id: 'snap-1',
        sourceKind: 'none',
        capturedAt: 1,
      } as never,
      isFirst: true,
      skillParams: { chatId: 'oc_abc' },
    })

    // Storing values the Agent never sees would be configuration theatre.
    expect(text).toContain('已配置参数')
    expect(text).toContain('chatId')
    expect(text).toContain('oc_abc')
  })

  it('omits the section when a Skill declares nothing', () => {
    const text = renderEnvelope({
      task: { id: 'task-1', epoch: 1 } as never,
      invocation: { id: 'inv-1', capabilityId: 'demo', skillName: 'demo' } as never,
      snapshot: { id: 'snap-1', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
    })

    expect(text).not.toContain('已配置参数')
  })
})

describe('Pet does not interpret Skill parameters', () => {
  it('carries arbitrary names it has never heard of', () => {
    const text = renderEnvelope({
      task: { id: 'task-1', epoch: 1 } as never,
      invocation: { id: 'inv-1', capabilityId: 'x', skillName: 'x' } as never,
      snapshot: { id: 'snap-1', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
      // Names Pet has no knowledge of: the Skill declared them and decides
      // what they mean. Pet must never special-case a particular parameter.
      skillParams: { retentionDays: '30', tone: 'formal', wobble: 'yes' },
    })

    expect(text).toContain('retentionDays')
    expect(text).toContain('tone')
    expect(text).toContain('wobble')
  })

  it('keeps values verbatim rather than reformatting them', () => {
    const text = renderEnvelope({
      task: { id: 'task-1', epoch: 1 } as never,
      invocation: { id: 'inv-1', capabilityId: 'x', skillName: 'x' } as never,
      snapshot: { id: 'snap-1', sourceKind: 'none', capturedAt: 1 } as never,
      isFirst: true,
      skillParams: { path: '/a/b c/d', json: '{"k":1}' },
    })

    expect(text).toContain('/a/b c/d')
    expect(text).toContain('{"k":1}')
  })
})

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
