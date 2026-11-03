import { describe, expect, it } from 'vitest'
import { createLocusChildAdapter, type LocusChildPorts, type LocusLiveParent } from '../src/host/locus/child.js'
import { readChildLog } from '../src/host/locus/startup-recovery.js'
import { FakeOfficialRuntime, FakeSessionQuery } from './support/official-subagent.js'

const LOCUS_MAIN = 'session-locus-main'

describe('名额已满时创建 locus child', () => {
  it('名额已满时创建 locus child', async () => {
    const runtime = new FakeOfficialRuntime({ activeLimit: 1 })
    runtime.addParent(LOCUS_MAIN)
    runtime.agents.set('session-busy', { id: 'session-busy', ctx: { agentId: 'session-busy' }, parentId: LOCUS_MAIN, inbox: [], turnOpen: false })
    const ports: LocusChildPorts = {
      parent: { get: id => runtime.agents.get(id) as unknown as LocusLiveParent | undefined, resume: async () => undefined },
      subagent: { startContinuable: spec => runtime.startContinuable(spec as never), getProvider: name => runtime.getProvider(name) },
    }
    const input = {
      parentSessionId: LOCUS_MAIN,
      childId: 'session-new',
      label: 'entry',
      prompt: [{ type: 'text' as const, text: 'first message' }],
    }

    const refused = await createLocusChildAdapter(ports).createChild(input)

    // Reported as capacity, not as a generic failure: nothing was created, so
    // the request is whole and can be retried unchanged.
    expect(refused).toMatchObject({ ok: false, reason: 'child-capacity-exhausted' })
    expect(runtime.agents.has('session-new')).toBe(false)
    expect(runtime.released.has('session-new')).toBe(false)

    // A slot frees; the same request now succeeds with the same identity.
    runtime.release('session-busy')
    const created = await createLocusChildAdapter(ports).createChild(input)
    expect(created).toMatchObject({ ok: true, identity: { childSessionId: 'session-new' } })
  })
})

describe('只读访问不长期占用名额', () => {
  it('只读访问不长期占用名额', async () => {
    const runtime = new FakeOfficialRuntime({ activeLimit: 1 })
    runtime.addParent(LOCUS_MAIN)
    // The only slot is taken by another entry's child; a released child sits on disk.
    runtime.agents.set('session-busy', { id: 'session-busy', ctx: { agentId: 'session-busy' }, parentId: LOCUS_MAIN, inbox: [], turnOpen: false })
    runtime.released.add('session-idle')
    const query = new FakeSessionQuery()
    query.add('session-idle', LOCUS_MAIN, [
      { type: 'session/start', seq: 0, time: 1, data: {} },
      { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const before = { active: runtime.activeChildren, starts: runtime.startCalls.length, queues: runtime.queueCalls.length }

    const read = await readChildLog(query, { parentSessionId: LOCUS_MAIN, childSessionId: 'session-idle' })

    // Read through the official cold path: no activation, no start, no queue.
    expect(read.ok).toBe(true)
    expect(query.observed).toEqual(['session-idle'])
    expect(runtime.activeChildren).toBe(before.active)
    expect(runtime.startCalls).toHaveLength(before.starts)
    expect(runtime.queueCalls).toHaveLength(before.queues)
    expect(runtime.agents.has('session-idle')).toBe(false)
    // And the observation lease is released, so it cannot hold anything either.
    expect(query.leases.every(lease => lease.disposed)).toBe(true)
  })

  it('reads as many released children as there are, regardless of the activation limit', async () => {
    const runtime = new FakeOfficialRuntime({ activeLimit: 0 })
    runtime.addParent(LOCUS_MAIN)
    const query = new FakeSessionQuery()
    for (let index = 0; index < 20; index += 1) {
      runtime.released.add(`session-${String(index)}`)
      query.add(`session-${String(index)}`, LOCUS_MAIN, [{ type: 'session/start', seq: 0, time: 1, data: {} }])
    }

    for (let index = 0; index < 20; index += 1) {
      const read = await readChildLog(query, { parentSessionId: LOCUS_MAIN, childSessionId: `session-${String(index)}` })
      expect(read.ok).toBe(true)
    }
    expect(runtime.activeChildren).toBe(0)
  })
})
