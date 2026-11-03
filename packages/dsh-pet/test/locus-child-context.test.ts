import { describe, expect, it, vi } from 'vitest'
import { composeLocusChild, LOCUS_CALLER_BOUND_TOOLS, LOCUS_SAFE_TOOL_NAMES } from '../src/host/locus/composition.js'
import { createLocusChildAdapter, type LocusLiveParent } from '../src/host/locus/child.js'
import { FakeOfficialRuntime } from './support/official-subagent.js'

describe('three-tier child context ownership', () => {
  it('旧 fork child 不受影响', () => {
    const install = vi.fn()
    expect(composeLocusChild({ id: 'historical-fork', scope: {} }, {
      lookup: { find: () => undefined }, surface: { install, visibleTools: () => [] },
    } as never)).toEqual({ composed: false })
    expect(install).not.toHaveBeenCalled()
  })

  it('子会话发现不自动成为主会话认知', async () => {
    const runtime = new FakeOfficialRuntime()
    const work = runtime.addParent('work')
    runtime.addParent('locus-main')
    runtime.agentCreatedListeners.push(({ agent }) => {
      composeLocusChild({ id: agent.id, scope: agent.ctx }, {
        lookup: { find: () => ({ parentSessionId: 'locus-main', childSessionId: agent.id, locusId: 'locus', generation: 1, permission: 'read', childComposition: 'tier3' }) },
        parentPreset: () => 'locus-base',
        policy: { apply: () => {}, resolve: () => 'read' },
        surface: { install: () => {}, setToolTier: () => {}, installOutboundGuard: () => {}, visibleTools: () => [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS] },
      })
    })
    const adapter = createLocusChildAdapter({
      parent: { get: id => runtime.agents.get(id) as unknown as LocusLiveParent, resume: async () => undefined },
      subagent: { startContinuable: spec => runtime.startContinuable(spec as never), getProvider: name => runtime.getProvider(name) },
    })
    expect(await adapter.createChild({ parentSessionId: 'locus-main', childId: 'child', label: 'entry', prompt: [{ type: 'text', text: 'ENTRY_FINDING' }] })).toMatchObject({ ok: true })
    expect(work.inbox).toEqual([])
    runtime.settle('child')
    expect(runtime.agents.get('locus-main')?.inbox).toEqual([{ kind: 'settlement-notice', from: 'child' }])
    expect(work.inbox).toEqual([])
    adapter.dispose()
  })
})
