import { describe, expect, it, vi } from 'vitest'
import { PET_LOCUS_FINISH_TOOL, PET_LOCUS_REQUEST_EXECUTION_TOOL, PET_LOCUS_WAIT_TOOL, registerPetTools } from '../src/host/tools.js'

function setup(managedEffects?: { register: (definition: any, effect: 'delivery' | 'todo-execution') => () => void; assertEntry: (execution: any) => void }) {
  const definitions: any[] = []
  const nativeDispose = vi.fn()
  const finish = vi.fn(async () => ({ sent: true, outcome: 'reply' }))
  const wait = vi.fn(async () => ({ accepted: true, deadline: 1, remainingMinutes: 1, capped: false }))
  const requestExecution = vi.fn(async () => ({ ok: true as const, outcome: 'dispatched' as const }))
  const locus = {
    endpoint: { chatId: 'c' }, locus: { locusId: 'l', generation: 1, state: 'active' },
    main: { sessionId: 'm' }, child: { sessionId: 'child' }, workspace: { workspaceId: 'w' },
    permission: { effective: 'read' }, contextAnchor: { status: 'unknown' },
    currentDelivery: { deliveryId: 'd', childSessionId: 'child', locusId: 'l', generation: 1, status: 'current', queueState: 'current' },
  }
  const capability = { deliveryId: 'd', executionId: 'e', turnId: 't', source: 'delivery' as const }
  const ctx = { tools: { register: (definition: any) => { definitions.push(definition); return nativeDispose } } }
  const dispose = registerPetTools(ctx as never, {
    repository: {} as never,
    locusLifecycle: {
      locusRepository: {} as never,
      currentCapability: () => capability,
      authorizeCurrentDelivery: () => locus as never,
      finishCurrentDelivery: finish,
      waitCurrentDelivery: wait,
    },
    intentTriage: {
      loci: {} as never,
      currentCapability: () => capability,
      authorizeCurrentDelivery: () => locus as never,
      requestExecution,
    },
    managedEffects,
  })
  return { definitions, finish, wait, requestExecution, dispose, nativeDispose }
}
const exec = { agent: { id: 'child' } } as any

describe('Pet managed-effects registration seam', () => {
  it('marks exact finish/wait/request definitions and no read/query definitions', () => {
    const registrations: Array<[any, string]> = []
    const { definitions } = setup({
      register: (definition, effect) => { registrations.push([definition, effect]); return () => {} },
      assertEntry: () => {},
    })
    expect(registrations).toEqual([
      [definitions.find(x => x.name === PET_LOCUS_FINISH_TOOL), 'delivery'],
      [definitions.find(x => x.name === PET_LOCUS_WAIT_TOOL), 'delivery'],
      [definitions.find(x => x.name === PET_LOCUS_REQUEST_EXECUTION_TOOL), 'todo-execution'],
    ])
  })

  it('rechecks captured execute bodies after authorization and denies effects when revoked', async () => {
    let calls = 0
    const { definitions, finish, wait, requestExecution } = setup({ register: () => () => {}, assertEntry: () => { if (++calls > 1) throw new Error('revoked') } })
    const finishDef = definitions.find(x => x.name === PET_LOCUS_FINISH_TOOL)
    await expect(finishDef.execute({ outcome: 'reply', text: 'hello' }, exec)).rejects.toThrow('revoked')
    expect(finish).not.toHaveBeenCalled()
    calls = 0
    const waitDef = definitions.find(x => x.name === PET_LOCUS_WAIT_TOOL)
    await expect(waitDef.execute({ waitMinutes: 1 }, exec)).rejects.toThrow('revoked')
    expect(wait).not.toHaveBeenCalled()
    calls = 0
    const requestDef = definitions.find(x => x.name === PET_LOCUS_REQUEST_EXECUTION_TOOL)
    await expect(requestDef.execute({ itemId: 'todo' }, exec)).rejects.toThrow('revoked')
    expect(requestExecution).not.toHaveBeenCalled()
  })

  it('keeps default callbacks unguarded and disposes native plus mark registrations', async () => {
    const { definitions, finish, dispose, nativeDispose } = setup()
    await expect(definitions.find(x => x.name === PET_LOCUS_FINISH_TOOL).execute({ outcome: 'reply', text: 'hello' }, exec)).resolves.toEqual({ sent: true, outcome: 'reply' })
    dispose()
    expect(nativeDispose).toHaveBeenCalled()

    const markDispose = vi.fn()
    const registered: any[] = []
    const managed = setup({ register: (definition) => { registered.push(definition); return markDispose }, assertEntry: () => {} })
    managed.dispose()
    expect(markDispose).toHaveBeenCalledTimes(3)
  })

  it('rolls back native registration if marking the actual definition throws', () => {
    const native = vi.fn()
    let registrations = 0
    const tools = { register: () => { registrations++; return native } }
    expect(() => registerPetTools({ tools } as never, {
      repository: {} as never,
      locusLifecycle: { locusRepository: {} as never, currentCapability: () => undefined },
      managedEffects: { register: () => { throw new Error('mark failed') }, assertEntry: () => {} },
    })).toThrow('mark failed')
    expect(registrations).toBe(2)
    expect(native).toHaveBeenCalledTimes(1)
  })
})
