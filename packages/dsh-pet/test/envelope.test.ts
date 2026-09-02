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
