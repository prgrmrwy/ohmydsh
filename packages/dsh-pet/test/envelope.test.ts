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
    expect(text).toContain('Configured parameters')
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

    expect(text).not.toContain('Configured parameters')
  })
})
