import { describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { SourceContextRegistry, type SourceResolver } from '../src/host/capture.js'
import { PetCoordinator, type PromptDispatcher } from '../src/host/coordinator.js'
import type { AgentRegistryLike } from '../src/host/executor.js'
import { openPetHarness, installTestSkill } from './harness.js'

const resolver: SourceResolver = {
  getSession: id => ({ id, title: `S ${id}`, cwd: '/repo' }),
  getWorkspace: () => undefined,
}

describe('probe: admission map eviction', () => {
  it('shows whether >64 scopes breaks per-scope serialization', async () => {
    const h = await openPetHarness()
    await installTestSkill(h, 'demo', { context: 'session-required' })
    const caps = new CapabilityRegistry()
    let created = 0
    const co = new PetCoordinator({
      repository: h.repository, capabilities: caps,
      agents: {
        create: async (o: any) => { created++; await new Promise(r => setTimeout(r, 5)); return { session: { id: o.sessionId } } },
        get: () => ({}),
      } as unknown as AgentRegistryLike,
      dispatcher: { dispatch: async () => {} } as PromptDispatcher,
      resolver, contextProviders: new SourceContextRegistry(),
      workspacePath: '/tmp/ws', selection: () => ({ providerId: 'p', modelId: 'm' }),
    })

    // Fill the admission map past its 64 bound with distinct scopes.
    for (let i = 0; i < 70; i++) {
      await co.accept({ clientInvocationId: `fill-${i}`, capabilityId: 'demo', sourceKind: 'session', sourceSessionId: `fill-${i}` })
    }
    console.log('tasks after fill:', h.repository.listTasks().length, 'creates:', created)

    // Now two concurrent accepts on ONE fresh scope. With serialization intact
    // the second must REUSE the first Task.
    const results = await Promise.allSettled([
      co.accept({ clientInvocationId: 'race-a', capabilityId: 'demo', sourceKind: 'session', sourceSessionId: 'race-scope' }),
      co.accept({ clientInvocationId: 'race-b', capabilityId: 'demo', sourceKind: 'session', sourceSessionId: 'race-scope' }),
    ])
    for (const r of results) {
      console.log(r.status, r.status === 'rejected' ? (r.reason?.code ?? r.reason?.message) : (r.value as any).task.id)
    }
    const forScope = h.repository.listTasks().filter(t => t.scopeKey === 'session:race-scope')
    console.log('tasks for race-scope:', forScope.length)
    await h.close()
    expect(true).toBe(true)
  })
})
