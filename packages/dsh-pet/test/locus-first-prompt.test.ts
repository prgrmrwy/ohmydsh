import { describe, expect, it, vi } from 'vitest'
import { createFirstPromptRegistry } from '../src/host/locus/first-prompt.js'

const delivery = { deliveryId: 'delivery', executionId: 'execution', correlation: { endpoint: { chatId: 'chat' }, locusId: 'locus', generation: 1, childSessionId: 'child' } }

describe('first prompt synchronous claim / durable binding barrier', () => {
  it('returns exact identity synchronously but blocks the first tool until durable binding commits', async () => {
    let release!: () => void
    const bind = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const registry = createFirstPromptRegistry({ bindQueued: bind })
    registry.expect('child', delivery)
    expect(registry.resolve({ childSessionId: 'child', messageId: 'inbox' })).toEqual(delivery)
    expect(registry.resolve({ childSessionId: 'child', messageId: 'second' })).toBeUndefined()
    let toolRan = false
    const tool = registry.whenBound('child').then(() => { toolRan = true })
    await Promise.resolve()
    expect(bind).toHaveBeenCalledOnce()
    expect(toolRan).toBe(false)
    release()
    await tool
    expect(toolRan).toBe(true)
    expect(registry.resolve({ childSessionId: 'child', messageId: 'inbox' })).toEqual(delivery)
    expect(bind).toHaveBeenCalledOnce()
    registry.retire('child')
    expect(registry.resolve({ childSessionId: 'child', messageId: 'inbox' })).toBeUndefined()
  })

  it('propagates a binding failure to the caller-bound tool instead of admitting it', async () => {
    const registry = createFirstPromptRegistry({ bindQueued: async () => { throw new Error('durable write refused') } })
    registry.expect('child', delivery)
    await expect(registry.whenBound('child')).rejects.toThrow('not been claimed')
    registry.resolve({ childSessionId: 'child', messageId: 'inbox' })
    await expect(registry.whenBound('child')).rejects.toThrow('durable write refused')
  })

  it('refuses empty, wrong-child and duplicate expectations', () => {
    const registry = createFirstPromptRegistry()
    expect(() => registry.expect('other', delivery)).toThrow('own child')
    registry.expect('child', delivery)
    expect(() => registry.expect('child', delivery)).toThrow('already has')
    expect(registry.resolve({ childSessionId: 'child', messageId: '' })).toBeUndefined()
    expect(registry.resolve({ childSessionId: 'other', messageId: 'inbox' })).toBeUndefined()
  })
})
