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

describe('probe: dispatching stuck state', () => {
  it('answer() cannot reach a recovering invocation; cancel/retry paths', async () => {
    const h = await openPetHarness()
    await installTestSkill(h, 'demo', { context: 'session-required' })
    const caps = new CapabilityRegistry()

    // Dispatcher that hangs then throws -> invocation goes 'recovering'
    let mode: 'throw' | 'ok' = 'throw'
    const dispatcher: PromptDispatcher = {
      dispatch: async () => { if (mode === 'throw') throw new Error('dispatch boom') },
    }
    const co = new PetCoordinator({
      repository: h.repository, capabilities: caps,
      agents: { create: async (o: any) => ({ session: { id: o.sessionId } }), get: () => ({}) } as unknown as AgentRegistryLike,
      dispatcher, resolver, contextProviders: new SourceContextRegistry(),
      workspacePath: '/tmp/ws', selection: () => ({ providerId: 'p', modelId: 'm' }),
    })

    const a = await co.accept({ clientInvocationId: 'inv-a', capabilityId: 'demo', sourceKind: 'session', sourceSessionId: 'src-1' })
    const taskId = a.task.id
    console.log('after failed dispatch: inv=', h.repository.getInvocation('inv-a')?.status,
                'task=', h.repository.getTask(taskId)?.status)
    console.log('slotFree=', h.repository.isSlotFree(taskId))
    console.log('findCurrentInvocation=', h.repository.findCurrentInvocation(taskId)?.id)

    // Can the user retry? retry() only accepts 'failed'.
    let retryErr: any
    try { await co.retry('inv-a') } catch (e: any) { retryErr = e.code ?? e.message }
    console.log('retry on recovering ->', retryErr)

    // Can the user cancel? cancel() uses findCurrentInvocation (running|waiting-user only)
    let cancelErr: any
    try { await co.cancel(taskId) } catch (e: any) { cancelErr = e.code ?? e.message }
    console.log('cancel on recovering ->', cancelErr)

    // Can a new invocation be queued and ever run?
    mode = 'ok'
    const b = await co.accept({ clientInvocationId: 'inv-b', capabilityId: 'demo', sourceKind: 'session', sourceSessionId: 'src-1' })
    console.log('second invocation started=', b.started, 'status=', h.repository.getInvocation('inv-b')?.status)

    // Can the task be archived to escape?
    let archErr: any
    try { await h.repository.archiveTask(taskId) } catch (e: any) { archErr = e.code ?? e.message }
    console.log('archiveTask ->', archErr)
    await h.close()
    expect(true).toBe(true)
  })
})
