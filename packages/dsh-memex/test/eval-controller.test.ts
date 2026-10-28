import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { controllerExecutionPort } from '../src/eval/controller.js'
import { executeFixedItem } from '../src/eval/executor.js'

it('uses ordinary controller create, pinned title, MANUAL endpoint, and exact selected route', async () => {
  const calls: unknown[] = []
  const agent = { id: 'reserved', options: { provider: 'mock', model: 'fixed', reasoningEffort: 'high' }, session: { header: { cwd: '/fixture/repo', agentPreset: 'standard' }, snapshotEvents: () => [{ type: 'session/title', data: { title: 'Pinned', source: { kind: 'user' } } }, { type: 'model/selection', data: { provider: 'mock', model: 'fixed', reasoningEffort: 'high' } }] }, whenIdle: async () => { calls.push('idle') } }
  const controller = {
    create: async (request: unknown) => { calls.push(request); return { sessionId: 'reserved' } },
    rename: async (request: unknown) => { calls.push(request) }, selectModel: async (request: unknown) => { calls.push(request) },
    resolveAgent: async () => ({ agent }), prompt: async (request: unknown) => { calls.push(request) },
  }
  const routing = async (operation: string, payload: unknown) => { calls.push([operation, payload]); return { mode: 'MANUAL' } }
  const port = controllerExecutionPort(controller as never, routing, '/fixture/repo', new AbortController().signal, mkdtempSync(join(realpathSync(tmpdir()), 'eval-controller-')))
  await port.create('reserved'); await port.rename('reserved', 'Pinned'); await port.setManual('reserved')
  await port.selectModel('reserved', { provider: 'mock', model: 'fixed', effort: 'high' })
  expect(await port.inspect('reserved')).toEqual({ title: 'Pinned', userPinned: true, mode: 'MANUAL', route: { provider: 'mock', model: 'fixed', effort: 'high' } })
  await port.prompt('reserved', 'fictional')
  expect(calls[0]).toEqual({ sessionId: 'reserved', cwd: '/fixture/repo', agentPreset: 'standard' })
  expect(calls).toContainEqual({ sessionId: 'reserved', provider: 'mock', model: 'fixed', reasoningEffort: 'high' })
  expect(calls.at(-1)).toBe('idle')
})

it('reads durable model/selection instead of immutable creation-time options before either turn', async () => {
  const selected = { provider: 'new-provider', model: 'new-model', reasoningEffort: 'high' }
  const agent = { id: 'reserved', options: { provider: 'daily', model: 'daily-model' }, session: {
    header: { cwd: '/repo', agentPreset: 'standard' }, snapshotEvents: () => [
      { type: 'session/title', data: { title: 'Pinned', source: { kind: 'user' } } },
      { type: 'model/selection', data: selected },
    ],
  } }
  const controller = { resolveAgent: async () => ({ agent }) }
  const port = controllerExecutionPort(controller as never, async () => ({ mode: 'MANUAL' }), '/repo', new AbortController().signal)
  expect((await port.inspect('reserved')).route).toEqual({ provider: 'new-provider', model: 'new-model', effort: 'high' })
})

it('EVAL-018 (controller level): a title that is not user-pinned on readback blocks the question with no controller prompt', async () => {
  for (const source of [{ kind: 'auto' }, undefined]) {
    let prompts = 0
    const agent = { id: 'reserved', options: { provider: 'mock', model: 'fixed' }, session: { header: { cwd: '/repo', agentPreset: 'standard' },
      snapshotEvents: () => source ? [{ type: 'session/title', data: { title: 'Memex selftest r/i/s', source } }] : [] }, whenIdle: async () => {} }
    const controller = { create: async () => ({ sessionId: 'reserved' }), rename: async () => {}, selectModel: async () => {}, resolveAgent: async () => ({ agent }), prompt: async () => { prompts++ } }
    const port = controllerExecutionPort(controller as never, async () => ({ mode: 'MANUAL' }), '/repo', new AbortController().signal, mkdtempSync(join(realpathSync(tmpdir()), 'eval-controller-pin-')))
    await expect(executeFixedItem(port, { sessionId: 'reserved', title: 'Memex selftest r/i/s', route: { provider: 'mock', model: 'fixed' }, prompt: 'fictional question' })).rejects.toThrow(/readback/)
    expect(prompts).toBe(0)
  }
})

it('does not deliver a duplicate controller prompt after adapter reconstruction', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-controller-receipt-'))
  let prompts = 0
  const controller = { prompt: async () => { prompts++ }, resolveAgent: async () => ({ agent: { whenIdle: async () => {} } }) }
  for (let i = 0; i < 2; i++) {
    const port = controllerExecutionPort(controller as never, async () => ({}), '/repo', new AbortController().signal, directory)
    await port.prompt('reserved', 'same fictional prompt')
  }
  expect(prompts).toBe(1)
})

it('binds a stable turn identity to text rather than silently treating changed text as a new turn', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-turn-'))
  let sent = 0
  const controller = { prompt: async () => { sent++ }, resolveAgent: async () => ({ agent: { whenIdle: async () => {} } }) }
  const port = controllerExecutionPort(controller as never, async () => ({}), '/repo', new AbortController().signal, directory)
  await port.prompt('reserved', 'original', 'initial')
  await expect(port.prompt('reserved', 'changed', 'initial')).rejects.toThrow(/mismatch/)
  await port.prompt('reserved', 'original', 'follow-up')
  expect(sent).toBe(2)
})

it('cancels the exact running tested Agent on carrier abort before waiting for idle and rejects completion', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-abort-prompt-'))
  let started!: () => void, idle!: () => void
  const running = new Promise<void>(resolve => { started = resolve })
  const stopped = new Promise<void>(resolve => { idle = resolve })
  let cancelled = 0
  const agent = { cancel: () => { cancelled++; idle() }, whenIdle: () => { started(); return stopped } }
  const controller = { prompt: async () => {}, resolveAgent: async () => ({ agent }) }
  const abort = new AbortController()
  const port = controllerExecutionPort(controller as never, async () => ({}), '/repo', abort.signal, directory)
  const work = port.prompt('reserved', 'fictional').catch(error => error)
  await running
  abort.abort()
  // Avoid leaving a pending test if cancellation is missing.
  await Promise.resolve()
  expect(cancelled).toBe(1)
  expect(await work).toMatchObject({ message: expect.stringMatching(/abort/) })
})

it('refuses prompt delivery without a durable receipt directory', async () => {
  let sent = false
  const port = controllerExecutionPort({ prompt: async () => { sent = true } } as never, async () => ({}), '/repo', new AbortController().signal)
  await expect(port.prompt('reserved', 'fictional')).rejects.toThrow(/receipt/)
  expect(sent).toBe(false)
})

it('checks the live Agent cwd and preset after explicit-id controller adoption', async () => {
  for (const header of [{ cwd: '/daily', agentPreset: 'standard' }, { cwd: '/repo', agentPreset: 'other' }]) {
    const controller = { create: async () => ({ sessionId: 'reserved' }), resolveAgent: async () => ({ agent: { id: 'reserved', session: { header } } }) }
    const port = controllerExecutionPort(controller as never, async () => ({}), '/repo', new AbortController().signal)
    await expect(port.create('reserved')).rejects.toThrow(/workspace or preset/)
  }
})

it('refuses controller identity mismatch before subsequent operations', async () => {
  const port = controllerExecutionPort({ create: async () => ({ sessionId: 'wrong' }) } as never, async () => ({}), '/repo', new AbortController().signal)
  await expect(port.create('reserved')).rejects.toThrow(/identity/)
})
