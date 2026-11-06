/**
 * First-child publication on the v20 contract (design D15, D16; owner C).
 *
 * The four durable writes are owner A's (`LocusRepositoryPortV20`); here a fake
 * records what the publication callbacks ask of them, and the first-prompt
 * registry is the real one. No generation appears anywhere: the correlation is
 * `(endpoint, locusId, sessionId)` and the fence is the row `revision` (D3).
 */
import { describe, expect, it } from 'vitest'
import { createFirstDeliveryPublication, type FirstDeliveryPublicationRepository } from '../src/host/locus/first-delivery-publication.js'
import { createFirstPromptRegistry } from '../src/host/locus/first-prompt.js'

type Call = { readonly method: string; readonly input: Record<string, unknown> }

function fakeRepository(fail: Partial<Record<string, Error[]>> = {}) {
  const calls: Call[] = []
  const record = (method: string) => async (input: Record<string, unknown>) => {
    calls.push({ method, input })
    const next = fail[method]?.shift()
    if (next !== undefined) throw next
  }
  const repository = {
    publishFirstDelivery: record('publishFirstDelivery'),
    commitFirstDelivery: record('commitFirstDelivery'),
    revertFirstDelivery: record('revertFirstDelivery'),
    failFirstDeliveryCreation: record('failFirstDeliveryCreation'),
  } as unknown as FirstDeliveryPublicationRepository
  return { repository, calls }
}

const locus = { locusId: 'locus-1', sessionId: 'session-1', revision: 7, endpoint: { chatId: 'oc-1' } }

function setup(fail: Partial<Record<string, Error[]>> = {}) {
  const { repository, calls } = fakeRepository(fail)
  const bound: string[] = []
  const firstPrompts = createFirstPromptRegistry({ bindQueued: async (_delivery, messageId) => { bound.push(messageId) } })
  const reserved = ['session-2', 'session-3']
  const reserveChildSessionId = () => reserved.shift()!
  const publication = createFirstDeliveryPublication({ repository, firstPrompts, reserveChildSessionId, now: () => 50 })({
    locus, deliveryId: 'delivery-1', executionId: 'execution-1',
  })
  return { calls, firstPrompts, publication, bound, reserveChildSessionId }
}

const identity = { locusId: 'locus-1', sessionId: 'session-1', revision: 7, deliveryId: 'delivery-1', now: 50 }

describe('first-child publication (v20)', () => {
  it('publishes the reserved identity fenced on revision and registers the first prompt by (locusId, sessionId)', async () => {
    const { calls, firstPrompts, publication } = setup()

    await publication.publish('session-1')

    expect(calls).toEqual([{ method: 'publishFirstDelivery', input: { ...identity, executionId: 'execution-1' } }])
    expect(firstPrompts.resolve({ childSessionId: 'session-1', messageId: 'inbox-1' })).toEqual({
      deliveryId: 'delivery-1',
      executionId: 'execution-1',
      correlation: { endpoint: { chatId: 'oc-1' }, locusId: 'locus-1', sessionId: 'session-1' },
    })
    expect(JSON.stringify(calls)).not.toContain('generation')
  })

  it('refuses a child that is not the reserved sessionId and writes nothing', async () => {
    const { calls, firstPrompts, publication } = setup()
    await expect(publication.publish('session-other')).rejects.toThrow('reserved')
    expect(calls).toEqual([])
    expect(firstPrompts.size).toBe(0)
  })

  it('retires the expectation when the durable publish is refused', async () => {
    const { firstPrompts, publication } = setup({ publishFirstDelivery: [Object.assign(new Error('conflict'), { code: 'LOCUS_CONFLICT' })] })
    await expect(publication.publish('session-1')).rejects.toThrow('conflict')
    expect(firstPrompts.size).toBe(0)
  })

  it('commits only after the first prompt is durably bound, then retires the bridge', async () => {
    const { calls, firstPrompts, publication, bound } = setup()
    await publication.publish('session-1')
    firstPrompts.resolve({ childSessionId: 'session-1', messageId: 'inbox-1' })

    await publication.commit!('session-1')

    expect(bound).toEqual(['inbox-1'])
    expect(calls.at(-1)).toEqual({ method: 'commitFirstDelivery', input: { executionId: 'execution-1', now: 50 } })
    expect(firstPrompts.size).toBe(0)
  })

  it('spec Scenario "回调内发布后创建被拒时回滚" (publication half): unpublish rotates through ONE revert write', async () => {
    const { calls, firstPrompts, publication } = setup()
    await publication.publish('session-1')

    await publication.unpublish('session-1')

    expect(calls.at(-1)?.method).toBe('revertFirstDelivery')
    expect(calls.at(-1)?.input).toMatchObject({ ...identity, executionId: 'execution-1' })
    expect(calls.at(-1)?.input).not.toHaveProperty('retryText')
    expect(calls.at(-1)?.input).not.toHaveProperty('recoveryDebt')
    expect(typeof calls.at(-1)?.input.reserveChildSessionId).toBe('function')
    expect(firstPrompts.size).toBe(0)
  })

  it('spec Scenario "创建失败不推进代际" (publication half): a pre-publication failure settles and rotates in one write', async () => {
    const { calls, publication } = setup()
    await publication.failed!('session-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'failFirstDeliveryCreation', input: identity })
    expect(typeof calls[0]!.input.reserveChildSessionId).toBe('function')
  })

  it('leaves blocking recovery debt when the old child release cannot be proven', async () => {
    const { calls, firstPrompts, publication } = setup()
    await publication.publish('session-1')
    await publication.recoveryDebt!('session-1')
    expect(calls.at(-1)).toEqual({ method: 'revertFirstDelivery', input: { ...identity, executionId: 'execution-1', recoveryDebt: true } })
    expect(firstPrompts.size).toBe(0)
  })

  it('takes the pre-prompt image exception only while nothing claimed the first prompt', async () => {
    const unclaimed = setup()
    await unclaimed.publication.publish('session-1')
    await unclaimed.publication.retryText!('session-1')
    expect(unclaimed.calls.at(-1)?.input).toMatchObject({ ...identity, executionId: 'execution-1', retryText: true })
    expect(unclaimed.firstPrompts.size).toBe(0)

    // A claim after which the runtime still refused is not pre-prompt proof:
    // the ordinary revert settles it, and the retry is refused.
    const claimed = setup()
    await claimed.publication.publish('session-1')
    claimed.firstPrompts.resolve({ childSessionId: 'session-1', messageId: 'inbox-1' })
    await expect(claimed.publication.retryText!('session-1')).rejects.toThrow('claimed')
    expect(claimed.calls.at(-1)?.input).not.toHaveProperty('retryText')
    expect(claimed.calls.at(-1)?.method).toBe('revertFirstDelivery')
  })

  it('a pre-publication image veto reverts without naming a publication that never happened', async () => {
    const { calls, publication } = setup()
    await publication.retryText('session-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'revertFirstDelivery', input: { ...identity, retryText: true } })
    expect(calls[0]!.input).not.toHaveProperty('executionId')
  })

  it.each([true, false])('spec Scenario "首图补偿失败保留恢复债务" (published=%s)', async publish => {
    const { calls, firstPrompts, publication } = setup({ revertFirstDelivery: [new Error('injected atomic write failure #2')] })
    if (publish) await publication.publish('session-1')

    await expect(publication.retryText!('session-1')).rejects.toThrow('injected atomic write failure #2')

    const reverts = calls.filter(call => call.method === 'revertFirstDelivery')
    expect(reverts.map(call => [call.input.retryText, call.input.recoveryDebt])).toEqual([[true, undefined], [undefined, true]])
    expect(firstPrompts.size).toBe(0)
  })
})
