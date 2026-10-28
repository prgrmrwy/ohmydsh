import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { EvalLedger } from '../src/eval/ledger.js'
import { settleHostOneShots, hostRetirementOperations } from '../src/eval/runtime-services.js'

it('uses official archive and scoped drain, with exact root authority', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-services-'))
  const ledger = new EvalLedger(directory)
  const id = ledger.reserve('round', 'know', 'mem')
  const root = { id }
  const calls: unknown[] = []
  const ctx = new Context()
  ctx.provide('workspaceRegistry')
  ctx.provide('subagents')
  ctx.set('workspaceRegistry', { archiveSession: async (id: string, options: unknown) => { calls.push([id, options]) } })
  ctx.set('subagents', { drainContinuableDescendants: async (parents: unknown[]) => { calls.push(parents) } })
  try {
    const operations = hostRetirementOperations(ctx, root as never, ledger, { healthy: () => true, settleJobs: async () => {} }, async () => { calls.push('one-shot') })
    await operations.archive(id)
    await operations.drainDescendants()
    await operations.settleOneShots()
    expect(calls).toEqual([[id, { stopActivity: true }], [root], 'one-shot'])
    await expect(operations.archive('daily')).rejects.toThrow(/unregistered/)
  } finally { await ctx.fiber.dispose() }
})

it('checks the official descendant catalog and live registry after owner job settlement', async () => {
  const ctx = new Context()
  ctx.provide('agents'); ctx.provide('subagents')
  const calls: string[] = []
  ctx.set('agents', { get: () => undefined })
  ctx.set('subagents', { listDescendants: async (id: string) => { calls.push(id); return [{ kind: 'child', id: 'released-child', mode: 'one-shot' }] } })
  try {
    await settleHostOneShots(ctx, { id: 'root' } as never, new Set(['released-child']), async () => { calls.push('jobs') })
    expect(calls).toEqual(['jobs', 'root'])
  } finally { await ctx.fiber.dispose() }
})

it('missing service or missing one-shot proof cannot silently succeed', async () => {
  const ctx = new Context()
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-missing-service-'))
  const ledger = new EvalLedger(directory)
  const id = ledger.reserve('round', 'know', 'mem')
  try {
    expect(() => hostRetirementOperations(ctx, { id } as never, ledger, { healthy: () => true, settleJobs: async () => {} }, async () => {})).toThrow(/service/)
  } finally { await ctx.fiber.dispose() }
})
