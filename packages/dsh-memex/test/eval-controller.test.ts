import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { controllerExecutionPort } from '../src/eval/controller.js'
import { executeFixedItem } from '../src/eval/executor.js'

it('uses ordinary controller create, pinned title, MANUAL endpoint, and exact selected route', async () => {
  const calls: unknown[] = []
  const agent = { id: 'reserved', options: { provider: 'mock', model: 'fixed', reasoningEffort: 'high' }, session: { header: { cwd: '/fixture/repo', agentPreset: 'standard' }, snapshotEvents: () => [{ type: 'session/title', data: { title: 'Pinned', source: { kind: 'user' } } }] }, whenIdle: async () => { calls.push('idle') } }
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
