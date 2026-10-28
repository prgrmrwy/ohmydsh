import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { EvalLedger } from '../src/eval/ledger.js'
import { createHostRetirer } from '../src/eval/host-retirer.js'
import { startHostEvalTracking } from '../src/eval/runtime-tracking.js'

it('cancels a real owned job, awaits producer release, and leaves unowned work alone', async () => {
  const ctx = new Context()
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-real-jobs-'))
  const ledger = new EvalLedger(directory)
  const id = ledger.reserve('round', 'know', 'mem')
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjection)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LocalJobRegistry, {})
    const controller = ctx.jobs.attachController('eval-test')
    const tracking = startHostEvalTracking(ctx, ledger, 'host-1', 1000)
    const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: directory } })
    let released = false
    let finish!: (outcome: { status: 'killed' }) => void
    const done = new Promise<{ status: 'killed' }>(resolve => { finish = resolve })
    const job = ctx.jobs.start({ kind: 'bash', label: 'fictional test resource', owner: handle.agent.id,
      run: () => ({ done, cancel: () => { released = true; finish({ status: 'killed' }) } }) })
    let finishGlobal!: (outcome: { status: 'completed' }) => void
    const globalDone = new Promise<{ status: 'completed' }>(resolve => { finishGlobal = resolve })
    const global = ctx.jobs.start({ kind: 'bash', label: 'unowned test control', run: () => ({ done: globalDone, cancel: () => { throw new Error('unowned was cancelled') } }) })
    try {
      let archived = false
      ctx.provide('workspaceRegistry'); ctx.provide('subagents')
      ctx.set('workspaceRegistry', { archiveSession: async (id: string, options: unknown) => { expect(id).toBe(handle.agent.id); expect(options).toEqual({ stopActivity: true }); archived = true } })
      ctx.set('subagents', { drainContinuableDescendants: async () => {}, listDescendants: async () => [] })
      await createHostRetirer(ctx, ledger, tracking)(handle.agent.id)
      expect(archived).toBe(true)
      expect(ctx.agents.get(handle.agent.id)).toBe(handle.agent)
      expect(released).toBe(true)
      expect(ctx.jobs.get(job, handle.agent.id).status).toBe('killed')
      expect(ctx.jobs.get(global).status).toBe('running')
      expect(ledger.releaseHistory('host-1').filter(e => e.id === job).map(e => e.type)).toEqual(['registered', 'settled'])
      await tracking.settleJobs()
    } finally {
      finishGlobal({ status: 'completed' })
      await ctx.jobs.wait(global, 1000)
      await handle.dispose()
      controller()
    }
  } finally { await ctx.fiber.dispose() }
})
