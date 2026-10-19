import { describe, expect, it, vi } from 'vitest'
import { createInquiryAgentResolver } from '../src/host/inquiry/agent-resolver.js'

type Agent = { readonly id: string }
const scope = (sessionId: string, kind: 'main' | 'child' = 'main') => ({ kind, sessionId })
function harness(overrides: Partial<Parameters<typeof createInquiryAgentResolver<Agent>>[0]> = {}) {
  const agents = new Map<string, Agent>()
  const ports = {
    getLive: vi.fn((id: string) => agents.get(id)),
    resumeMain: vi.fn(async (id: string) => { agents.set(id, { id }) }),
    parentSessionOf: vi.fn(() => 'parent'),
    materializeChild: vi.fn(async (_parent: Agent, id: string) => { agents.set(id, { id }) }),
    log: vi.fn(),
    ...overrides,
  }
  return { agents, ports, resolve: createInquiryAgentResolver<Agent>(ports) }
}

describe('inquiry agent resolver', () => {
  it('returns an online agent without restoring', async () => {
    const h = harness(); const agent = { id: 's' }; h.agents.set('s', agent)
    expect(await h.resolve(scope('s'))).toBe(agent)
    expect(h.ports.resumeMain).not.toHaveBeenCalled(); expect(h.ports.materializeChild).not.toHaveBeenCalled()
  })
  it('cold-restores a main session', async () => {
    const h = harness()
    expect(await h.resolve(scope('s'))).toEqual({ id: 's' }); expect(h.ports.resumeMain).toHaveBeenCalledOnce()
  })
  it('materializes a child using the exact live parent object', async () => {
    const h = harness(); const parent = { id: 'parent' }; h.agents.set('parent', parent)
    await h.resolve(scope('child', 'child'))
    expect(h.ports.materializeChild).toHaveBeenCalledWith(parent, 'child', expect.any(AbortSignal))
    expect(h.ports.materializeChild).toHaveBeenCalledOnce()
  })
  it('restores a cold parent before materializing its child', async () => {
    const h = harness(); const order: string[] = []
    h.ports.resumeMain.mockImplementationOnce(async id => { order.push(`resume:${id}`); h.agents.set(id, { id }) })
    h.ports.materializeChild.mockImplementationOnce(async (_p, id) => { order.push(`child:${id}`); h.agents.set(id, { id }) })
    await h.resolve(scope('child', 'child')); expect(order).toEqual(['resume:parent', 'child:child'])
  })
  it('fails closed if no parent is known', async () => {
    const h = harness({ parentSessionOf: vi.fn(() => undefined) })
    expect(await h.resolve(scope('child', 'child'))).toBeUndefined(); expect(h.ports.materializeChild).not.toHaveBeenCalled()
  })
  it('contains port failures and logs', async () => {
    const h = harness({ resumeMain: vi.fn(async () => { throw new Error('nope') }) })
    await expect(h.resolve(scope('s'))).resolves.toBeUndefined(); expect(h.ports.log).toHaveBeenCalledOnce()
  })
  it('aborts a timed out port', async () => {
    let signal: AbortSignal | undefined
    const h = harness({ timeoutMs: 5, resumeMain: vi.fn((_id: string, s: AbortSignal) => { signal = s; return new Promise<void>(() => {}) }) })
    await expect(h.resolve(scope('s'))).resolves.toBeUndefined(); expect(signal?.aborted).toBe(true)
  })
  it('single-flights concurrent restoration', async () => {
    let finish!: () => void
    const h = harness({ resumeMain: vi.fn(async id => { await new Promise<void>(r => { finish = r }); h.agents.set(id, { id }) }) })
    const calls = [h.resolve(scope('s')), h.resolve(scope('s')), h.resolve(scope('s'))]
    await Promise.resolve(); finish()
    expect(await Promise.all(calls)).toEqual([{ id: 's' }, { id: 's' }, { id: 's' }]); expect(h.ports.resumeMain).toHaveBeenCalledOnce()
  })
  it('clears failed flight so later calls retry', async () => {
    const resume = vi.fn().mockRejectedValueOnce(new Error('fail')).mockImplementationOnce(async (id: string) => { h.agents.set(id, { id }) })
    const h = harness({ resumeMain: resume })
    expect(await h.resolve(scope('s'))).toBeUndefined(); expect(await h.resolve(scope('s'))).toEqual({ id: 's' }); expect(resume).toHaveBeenCalledTimes(2)
  })
  it('rejects agents whose id does not match the scope', async () => {
    const h = harness({ getLive: vi.fn(() => ({ id: 'other' })) })
    expect(await h.resolve(scope('s'))).toBeUndefined()
  })
})
