import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { EvalLedger } from '../src/eval/ledger.js'
import { startEvalTracking } from '../src/eval/tracking.js'
import type { EvalJobEvent } from '../src/eval/host-jobs.js'

it('joins creation lineage with owned jobs before any test work and persists full evidence', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-tracking-'))
  const ledger = new EvalLedger(directory, join(directory, 'public.ndjson'))
  const root = ledger.reserve('round', 'know', 'mem')
  const ctx = new Context()
  let listener: (event: EvalJobEvent) => void = () => {}
  let unsubscribed = false
  const tracking = startEvalTracking(ctx, ledger, {
    events: { subscribe: (_filter, callback) => { listener = callback; return () => { unsubscribed = true } } },
    list: () => [], kill: () => {}, wait: async () => {},
  }, 'host-1', 20)
  try {
    await ctx.serial('agent/created', { agent: { id: 'child', session: { header: { parentSession: root } } } } as never)
    listener({ type: 'registered', job: { id: 'bash-1', owner: 'child', status: 'running' } })
    listener({ type: 'settled', job: { id: 'bash-1', owner: 'child', status: 'completed' } })
    await tracking.settleJobs()
    expect(ledger.releaseHistory('host-1')).toHaveLength(2)
    expect(ledger.read()).toContainEqual(expect.objectContaining({ kind: 'job', id: 'bash-1', parent: 'child' }))
    expect(tracking.healthy()).toBe(true)
  } finally { await ctx.fiber.dispose() }
  expect(unsubscribed).toBe(true)
})

it('rejects cross-Host tracking before subscribing or starting work', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-generation-'))
  const ledger = new EvalLedger(directory)
  ledger.recordRelease({ type: 'registered', id: 'old', owner: 'root', generation: 'old-host' })
  const ctx = new Context()
  let subscribed = false
  try {
    expect(() => startEvalTracking(ctx, ledger, {
      events: { subscribe: () => { subscribed = true; return () => {} } },
      list: () => [], kill: () => {}, wait: async () => {},
    }, 'new-host', 20)).toThrow(/Host generation/)
    expect(subscribed).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
