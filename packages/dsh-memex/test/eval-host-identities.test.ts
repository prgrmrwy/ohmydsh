import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { EvalLedger } from '../src/eval/ledger.js'
import { retireHostTestRoot } from '../src/eval/host-retirement.js'
import { registerEvalIdentities } from '../src/eval/identities.js'

it('records a reserved root on the real registry publication boundary without prompting a model', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-real-identity-'))
  const ledger = new EvalLedger(directory, join(directory, 'public.ndjson'))
  const id = ledger.reserve('round', 'know', 'mem')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjection)
    await ctx.plugin(AgentLoop, { agents: [] })
    const tracking = registerEvalIdentities(ctx, ledger)
    const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: directory } })
    try {
      expect(tracking.owners.has(handle.agent.id)).toBe(true)
      expect(ledger.read().some(e => e.kind === 'created' && e.id === id)).toBe(true)
      const notices: string[] = []
      await retireHostTestRoot(ctx, handle.agent, ledger, {
        archive: async sessionId => { notices.push(sessionId) },
        settleJobs: async () => {},
        drainDescendants: async () => { handle.agent.inject(createUserMessage({ content: [{ type: 'text', text: 'child settled' }], source: { kind: 'user' } })) },
        settleOneShots: async () => {},
        healthy: tracking.healthy,
      })
      expect(notices).toEqual([id])
      expect(handle.agent.inbox.hasPending).toBe(false)
      expect(ctx.agents.get(handle.agent.id)).toBe(handle.agent)
    } finally { await handle.dispose() }
  } finally { await ctx.fiber.dispose() }
})

it('marks tracking unhealthy when the durable ledger cannot be read during publication', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-corrupt-identities-'))
  const ledger = new EvalLedger(directory)
  ledger.reserve('round', 'know', 'mem')
  const ctx = new Context()
  const tracking = registerEvalIdentities(ctx, ledger)
  try {
    writeFileSync(join(directory, 'ledger.ndjson'), 'corrupt\n')
    await expect(ctx.serial('agent/created', { agent: { id: 'child', session: { header: {} } } } as never)).rejects.toThrow()
    expect(tracking.healthy()).toBe(false)
  } finally { await ctx.fiber.dispose() }
})

it('persists recursive Host creation events before the caller continues, excluding daily sessions', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-host-identities-'))
  const registry = join(directory, 'public.ndjson')
  const ledger = new EvalLedger(directory, registry)
  const root = ledger.reserve('round', 'know', 'mem')
  const ctx = new Context()
  const tracking = registerEvalIdentities(ctx, ledger)
  try {
    for (const [id, parentSession] of [['daily', undefined], [root, undefined], ['child', root], ['grandchild', 'child']]) {
      await ctx.serial('agent/created', { agent: { id, session: { header: { parentSession } } } } as never)
    }
    expect(tracking.owners).toEqual(new Set([root, 'child', 'grandchild']))
    expect(ledger.read().filter(e => e.kind === 'child').map(e => e.id)).toEqual(['child', 'grandchild'])
    const records = readFileSync(registry, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(records.every(record => record.round === 'round')).toBe(true)
    expect(readFileSync(registry, 'utf8')).not.toContain('grandchild')
    expect(tracking.healthy()).toBe(true)
  } finally { await ctx.fiber.dispose() }
})
