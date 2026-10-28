import { afterEach, expect, it } from 'vitest'
import { harness, closeHarness } from './host-harness.js'
import { tier } from './fake-jev.js'
afterEach(closeHarness)
it('exposes one Host mode service sharing the same state and invalidation path as the authenticated endpoints', async () => {
  const h = await harness(tier('high'))
  const service = h.ctx.get('autoModelRouting' as never) as unknown as { call(op: 'state' | 'setMode', payload: unknown): Promise<unknown> }
  expect(service).toBeDefined()
  expect(await service.call('setMode', { sessionId: h.agent!.id, mode: 'MANUAL' })).toMatchObject({ mode: 'MANUAL' })
  expect(await h.invoke('state', { sessionId: h.agent!.id })).toMatchObject({ mode: 'MANUAL' })
  await h.invoke('setMode', { sessionId: h.agent!.id, mode: 'AUTO' })
  expect(await service.call('state', { sessionId: h.agent!.id })).toMatchObject({ mode: 'AUTO' })
  await expect(service.call('setMode', { sessionId: 'daily-unknown', mode: 'MANUAL' })).rejects.toThrow()
  await expect(service.call('setMode', { sessionId: h.agent!.id, mode: 'UNSAFE' })).rejects.toThrow()
})
