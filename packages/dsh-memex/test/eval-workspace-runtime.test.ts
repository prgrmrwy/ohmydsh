import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as Sqlite from '@deepseek-ai/dsh-storage-sqlite'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Workspace from '@deepseek-ai/dsh-workspace'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { EvalLedger } from '../src/eval/ledger.js'
import { hostRetirementOperations } from '../src/eval/runtime-services.js'

it('archives only the registered test identity through the real WorkspaceRegistry without deleting history', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-workspace-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(Sqlite, { path: ':memory:' })
    await ctx.plugin(Domain, { backend: 'sqlite' })
    await ctx.plugin(Jsonl, { root: join(directory, 'sessions'), compression: 'none' })
    await ctx.plugin(Workspace)
    const ledger = new EvalLedger(directory), id = SessionId(ledger.reserve('round', 'know', 'mem'))
    const handle = await ctx.sessionPersistence.create({ id, version: 4, createdAt: 1, cwd: directory, isSeeded: false, delegationDepth: 0 })
    try {
      await handle.flush()
      ctx.provide('subagents'); ctx.set('subagents', { drainContinuableDescendants: async () => {} })
      const operations = hostRetirementOperations(ctx, { id } as never, ledger, { healthy: () => true, settleJobs: async () => {} }, async () => {})
      let stopRequested = false
      ctx.on('workspace/session-stop', request => { expect(request.sessionId).toBe(id); stopRequested = true; throw new Error('fictional stop provider failed') })
      await operations.archive(id)
      expect(stopRequested).toBe(true)
      expect(ctx.workspaceRegistry.archivedSessionIds).toContain(id)
      expect(await ctx.sessionPersistence.stat(id)).toBeDefined()
      await expect(operations.archive('daily')).rejects.toThrow(/unregistered/)
      expect(ctx.workspaceRegistry.archivedSessionIds).toEqual([id])
    } finally { await handle.close() }
  } finally { await ctx.fiber.dispose() }
})
