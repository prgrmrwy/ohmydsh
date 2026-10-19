import { it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Agents, { type Agent } from '@deepseek-ai/dsh-agent'
import Sessions from '@deepseek-ai/dsh-session'
import Llm, { LlmAdapter, createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Projections from '@deepseek-ai/dsh-session-projection'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createInquiryAgentAdapter } from '../src/host/inquiry/agent-adapter.js'
import type { InquiryScope } from '../src/host/inquiry/ledger.js'

const scope: InquiryScope = { kind: 'main', sessionId: 'adapter-test' }

async function harness(onStream: () => void, onTool?: (execution: import('@deepseek-ai/dsh-tools').ToolExecution) => void, toolMode = false) {
  const ctx = new Context()
  for (const plugin of [Sessions, Agents, Llm, Prompt, Tools, Projections]) await ctx.plugin(plugin)
  class Fake extends LlmAdapter {
    private calls = 0
    async *stream() {
      onStream()
      if (toolMode && this.calls++ === 0) {
        const block = { type: 'tool-call', id: 'capture-1', name: 'capture', arguments: '{}' }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: 'capture-1', name: 'capture', argumentsDelta: '{}' }
        yield { type: 'block-end', index: 0, block }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'done' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  ctx.llm.registerAdapter(['fake'], new Fake())
  if (onTool) {
    ctx.tools.register(defineTool({
      name: 'capture', description: 'Capture invocation provenance', parameters: {},
      output: { schema: { type: 'boolean' }, render: () => [] },
      async execute(_args, execution) { onTool(execution); return true },
    }))
  }
  if (toolMode) {
    ctx.tools.register(defineTool({
      name: 'nested_capture', description: 'Capture nested invocation provenance', parameters: {},
      output: { schema: { type: 'boolean' }, render: () => [] },
      async execute(_args, execution) { onTool?.(execution); return true },
    }))
  }
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  const agent = await ctx.agentLoop.create('adapter-test', { provider: 'fake', model: 'm' })
  const claims: Array<{ scope: InquiryScope; id: string; turn: number }> = []
  const works = {
    async claimLocalWork(workScope: InquiryScope, messageId: string, turn: number) {
      claims.push({ scope: workScope, id: messageId, turn })
      return { sessionId: workScope.sessionId, workId: messageId, scopeGeneration: 0, rootClaimTurn: turn, state: 'active', openInquiryIds: [], continuationTurn: null }
    },
    async endTurn() { return undefined },
  }
  const adapter = createInquiryAgentAdapter(agent as Agent, { currentScope: () => scope, works: works as never, now: () => 123 })
  return { ctx, agent, adapter, claims }
}

it('claims the actual GUI root before the real AgentLoop reaches the model', async () => {
  let harnessRef: Awaited<ReturnType<typeof harness>> | undefined
  const h = await harness(() => expect(harnessRef?.claims).toHaveLength(1))
  harnessRef = h
  try {
    const gui = createUserMessage({ content: [{ type: 'text', text: 'GUI task' }], source: { kind: 'user' } })
    h.agent.followup(gui)
    await h.agent.whenIdle()
    expect(h.claims).toEqual([{ scope, id: gui.id, turn: 1 }])
    expect(h.adapter.currentWork(1)).toBeUndefined()
    expect(h.adapter.occupiesRunSlot).toBe(false)
  } finally { await h.ctx.fiber.dispose() }
})

it('runs installed runtime pre-step listeners on every real AgentLoop step', async () => {
  const h = await harness(() => {})
  const seen: number[] = []
  h.adapter.on('agent/pre-step', async (payload, next) => { seen.push(payload.step); return next() })
  try {
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'GUI task' }], source: { kind: 'user' } }))
    await h.agent.whenIdle()
    expect(seen.length).toBeGreaterThan(0)
    expect(h.claims).toHaveLength(1)
  } finally { await h.ctx.fiber.dispose() }
})

it('captures real model tool-call proof for the GUI root and removes it at turn end', async () => {
  const executions: import('@deepseek-ai/dsh-tools').ToolExecution[] = []
  const proofs: Array<import('../src/host/inquiry/agent-adapter.js').InquiryExecutionProof | undefined> = []
  let h: Awaited<ReturnType<typeof harness>>
  h = await harness(() => {}, execution => { executions.push(execution); proofs.push(h.adapter.executionProof(execution)) }, true)
  const preSteps: number[] = []
  h.adapter.on('agent/pre-step', async (payload, next) => { preSteps.push(payload.step); return next() })
  const gui = createUserMessage({ content: [{ type: 'text', text: 'GUI tool task' }], source: { kind: 'user' } })
  try {
    h.agent.followup(gui)
    await h.agent.whenIdle()
    expect(h.claims).toEqual([{ scope, id: gui.id, turn: 1 }])
    expect(executions).toHaveLength(1)
    const proof = proofs[0]!
    expect(proof).toMatchObject({ sessionId: h.agent.id, turn: 1, scope })
    expect(proof!.signal.aborted).toBe(false)
    expect(h.adapter.executionProof(executions[0]!)).toBeUndefined()
    expect(proof!.active).toBe(false)
    expect(preSteps).toHaveLength(2)
  } finally { await h.ctx.fiber.dispose() }
})

it('inherits GUI provenance through official parent-token nested tool execution', async () => {
  const proofs: import('../src/host/inquiry/agent-adapter.js').InquiryExecutionProof[] = []
  let h: Awaited<ReturnType<typeof harness>>
  h = await harness(() => {}, execution => {
    const proof = h.adapter.executionProof(execution)
    if (proof) proofs.push(proof)
    if (execution.name === 'capture') {
      void h.ctx.tools.execute({
        agent: h.agent,
        name: 'nested_capture',
        callId: 'nested-1' as ToolCallId,
        arguments: {},
        signal: execution.signal,
        parent: execution.token,
      })
    }
  }, true)
  const gui = createUserMessage({ content: [{ type: 'text', text: 'GUI nested tool task' }], source: { kind: 'user' } })
  try {
    h.agent.followup(gui)
    await h.agent.whenIdle()
    expect(h.claims).toEqual([{ scope, id: gui.id, turn: 1 }])
    expect(proofs).toHaveLength(2)
    expect(proofs[0]).toBe(proofs[1])
    expect(proofs[0]).toMatchObject({ sessionId: h.agent.id, turn: 1, scope, active: false })
  } finally { await h.ctx.fiber.dispose() }
})

it('does not create a root for injected inquiry input and installs on the Agent Context', async () => {
  const h = await harness(() => {})
  try {
    const inquiry = createUserMessage({ content: [{ type: 'text', text: 'injected inquiry' }], source: { kind: 'pet-inquiry' } as never })
    h.agent.followup(inquiry)
    await h.agent.whenIdle()
    expect(h.claims).toHaveLength(0)
    expect(h.adapter.currentWork(1)).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})
