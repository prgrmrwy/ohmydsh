import { describe, expect, it, vi } from 'vitest'
import Sessions from '@deepseek-ai/dsh-session'
import Agents, { type Agent } from '@deepseek-ai/dsh-agent'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Projections from '@deepseek-ai/dsh-session-projection'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { buildLocusRecord } from '../src/host/locus/aggregate.js'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { composeProductionInquiry } from '../src/host/inquiry/composition.js'
import { openPetHarness } from './harness.js'
import { Context } from '@deepseek-ai/cordis'
import { registerInquiryAskTool, registerInquiryAnswerTool } from '../src/host/inquiry/tools.js'

const scope = { kind: 'main' as const, sessionId: 'inquiry-test' }

/** A real DSH Context tools registry, with only external host capabilities stubbed. */
describe('production inquiry composition', () => {
  it('fails closed unless the live loop, probe, managed guard and tools capability exist', async () => {
    const h = await openPetHarness()
    try {
      const composed = composeProductionInquiry({
        domain: h.domain as never, currentScope: () => scope, resolveAgent: () => undefined,
        agentLoop: undefined, probeIsolatedClaim: undefined,
        tools: { supportsFinalToolGuardRecheck: false }, readinessManagedGuard: () => false,
        log: vi.fn(), onError: vi.fn(), now: () => 1, newMessageId: () => 'm', newInquiryId: () => 'i',
      })
      expect(composed.ready).toBe(false)
      expect(composed.answerBinding(scope.sessionId, 'i', {} as never)).toBe(false)
      expect(composed.origin(scope.sessionId)).toBeUndefined()
    } finally { await h.close() }
  })

  it('registers actual ask/answer tools on a DSH Context and keeps unproven execution unbound', async () => {
    const h = await openPetHarness()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const disposers: Array<() => void> = []
    try {
      const agent = { id: scope.sessionId, session: { id: scope.sessionId } } as never
      // Install real tools with the production API shape. The caller's execution is supplied by DSH.
      disposers.push(registerInquiryAskTool(ctx, { forExecution: () => ({
        ports: {} as never, store: { accept: vi.fn(async () => { throw new Error('unproven') }) },
        ready: () => false, origin: () => undefined, now: () => 1, newInquiryId: () => 'i',
      }) }))
      disposers.push(registerInquiryAnswerTool(ctx, {
        ports: {} as never, ledger: {} as never, answers: {} as never,
        commitAnswer: vi.fn(), binding: () => false, afterAnswer: vi.fn(), now: () => 1, newEventId: () => 'e',
      }))
      const tools = (ctx as never as { get(key: string): { get(name: string): unknown } }).get('tools')
      expect(tools.get('pet_inquire')).toBeDefined()
      expect(tools.get('pet_inquiry_answer')).toBeDefined()
      expect(agent).toBeDefined()
      expect(h.domain.supportsTransaction).toBe(true)
    } finally {
      for (const dispose of disposers.reverse()) dispose()
      await h.close()
    }
  })

  it('accepts a model-issued inquiry and delivers its correlated target message before the target model runs', async () => {
    const h = await openPetHarness()
    const ctx = new Context()
    for (const plugin of [Sessions, Agents, Llm, SystemPrompt, ToolRuntime, Projections]) await ctx.plugin(plugin)
    let payloadResolve!: (value: { inquiryId: string; messageId: string; body: Record<string, unknown>; work: unknown }) => void
    let payloadReject!: (error: Error) => void
    const targetPayload = new Promise<{ inquiryId: string; messageId: string; body: Record<string, unknown>; work: unknown }>((resolve, reject) => { payloadResolve = resolve; payloadReject = reject })
    const targetRef = 'child:b:1:child-b'
    const guiMessage = createUserMessage({ content: [{ type: 'text', text: 'ask target' }], source: { kind: 'user' } })
    const claims: Array<{ agentId: string; turn: number; messageId: string }> = []

    const mountedGuards = new Set<string>()
    class FakeLlm extends LlmAdapter {
      private count = 0
      constructor(private readonly target: boolean) { super() }
      async *stream(request: { messages: Array<{ content?: Array<{ type: string; text?: string }> }> }) {
        if (this.target) {
          const body = request.messages.flatMap(message => message.content ?? [])
            .filter(block => block.type === 'text').map(block => {
              try { return JSON.parse(block.text ?? '') as Record<string, unknown> } catch { return undefined }
            }).find(value => value && typeof value.inquiryId === 'string' && typeof value.question === 'string' && typeof value.purpose === 'string')
          expect(body).toBeDefined()
          const handoff = h.domain.table('inquiry_handoffs').entries().map(([, value]) => value as { inquiryId: string; phase: string; messageId: string; state: string; claimTurn?: number }).find(value => value.phase === 'target')!
          const inquiry = h.domain.table('inquiries').get(handoff.inquiryId) as { status: string }
          const claim = claims.find(value => value.agentId === targetRef.slice('child:b:1:'.length) && value.messageId === handoff.messageId)
          const workRow = [...h.domain.table('inquiry_works').entries()].map(([, value]) => value as { workId: string; openInquiryIds: string[] }).find(value => value.workId === guiMessage.id)
          expect(inquiry.status).toBe('executing')
          expect(handoff.state).toBe('claimed')
          expect(claim).toBeDefined()
          expect(handoff.claimTurn).toBe(claim?.turn)
          expect(workRow?.openInquiryIds).toContain(handoff.inquiryId)
          payloadResolve({ inquiryId: handoff.inquiryId, messageId: handoff.messageId, body: body!, work: { inquiry, work: workRow, claim } })
        } else if (this.count++ === 0) {
          const block = { type: 'tool-call', id: 'model-inquire-1', name: 'pet_inquire', arguments: JSON.stringify({ target: targetRef, question: 'q', purpose: 'p' }) }
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
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
    const disposers: Array<() => void> = []
    try {
      ctx.llm.registerAdapter(['askerfake'], new FakeLlm(false))
      ctx.llm.registerAdapter(['targetfake'], new FakeLlm(true))
      await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
      const asker = await ctx.agentLoop.create('main', { provider: 'askerfake', model: 'm' })
      const target = await ctx.agentLoop.create('child-b', { provider: 'targetfake', model: 'm' })
      const scopes = new Map<string, import('../src/host/inquiry/ledger.js').InquiryScope>([
        ['main', { kind: 'main', sessionId: 'main' }], ['child-b', { kind: 'child', sessionId: 'child-b', locusId: 'b', generation: 1 }],
      ])
      const locus = buildLocusRecord({ id: 'b', generation: 1, parentSessionId: 'main', childSessionId: 'child-b', endpoint: { chatId: 'chat-b' }, workspaceId: 'ws', source: 'explicit', state: 'active' })
      const identities = new Map([['main', { id: 'main' }], ['child-b', { id: 'child-b', parentSessionId: 'main' }]])
      const collaborationPorts = {
        loci: {
          findByChildSessionId: (id: string) => id === 'child-b' ? [locus] : [],
          getLocusByChild: (id: string) => id === 'child-b' ? locus : undefined,
          listLociByParent: (id: string) => id === 'main' ? [locus] : [],
          getCurrentLocus: (endpoint: { chatId: string; threadId?: string }) => endpoint.chatId === locus.endpoint.chatId && endpoint.threadId === locus.endpoint.threadId ? locus : undefined,
        },
        inspect: async (id: string) => identities.get(id), isArchived: () => false, hasPublicContext: () => true,
      }
      const resolveAgent = (scope: { sessionId: string }) => scope.sessionId === 'main' ? asker : scope.sessionId === 'child-b' ? target : undefined
      const guard = (agent: typeof asker, scopeId: string) => {
        agent.ctx.tools.guard((execution: { name: string }) => execution.name === 'pet_inquire' || execution.name === 'pet_inquiry_answer' ? undefined : `fixture denies ${scopeId}`)
        mountedGuards.add(scopeId)
      }
      guard(asker, 'main'); guard(target, 'child-b')
      const composed = composeProductionInquiry({
        domain: h.domain as never, currentScope: (id: string) => scopes.get(id), resolveAgent: resolveAgent as never,
        agentLoop: ctx.agentLoop,
        probeIsolatedClaim: ctx.agentLoop.probeIsolatedQueuedTurnClaim.bind(ctx.agentLoop),
        tools: ctx.tools, readinessManagedGuard: () => mountedGuards.size === 2,
        log: () => undefined, onError: payloadReject, now: () => 1_800_000_000_000, newMessageId: (() => { let n = 0; return () => `message-${++n}` })(), newInquiryId: () => 'inquiry-live',
      })
      expect(composed.ready).toBe(true)
      composed.install(asker as Agent); composed.install(target as Agent)
      disposers.push(registerInquiryAskTool(asker.ctx, { forExecution: execution => {
        const bound = composed.forExecution(execution as never)
        return { ports: collaborationPorts as never, store: { accept: bound.accept }, origin: bound.origin, ready: () => composed.ready, now: () => 1_800_000_000_000, newInquiryId: () => 'inquiry-live' }
      } }))
      ctx.on('agent/inbox/claimed', (event: { agent: { id: string }; turn: number; message: { id: string } }) => claims.push({ agentId: event.agent.id, turn: event.turn, messageId: event.message.id }))
      // `tools/result` is scope-filtered by exec.agent, so subscribe on the
      // asker's Context rather than the parent Context.
      asker.ctx.on('tools/result', (execution: { name: string }, result: { isError: boolean; content: Array<{ type: string; text?: string }> }) => {
        if (execution.name !== 'pet_inquire' || !result.isError) return
        const detail = result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join(' ').slice(0, 500)
        payloadReject(new Error(`pet_inquire tool failed${detail ? `: ${detail}` : ''}`))
      })
      asker.followup(guiMessage)
      let timer: ReturnType<typeof setTimeout> | undefined
      const delivered = await Promise.race([targetPayload, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('target inquiry timed out after 4s (target handoff unresolved)')), 4000) })]).finally(() => { if (timer) clearTimeout(timer) })
      await asker.whenIdle()
      expect(delivered.body).toMatchObject({ inquiryId: 'inquiry-live', question: 'q', purpose: 'p' })
      expect(delivered.messageId).toBeTruthy()
      expect(delivered.work).toMatchObject({ inquiry: { status: 'executing' }, work: { openInquiryIds: ['inquiry-live'] } })
      // Execution liveness is asserted on the delivered model snapshot above; after idle, the live inquiry is already unavailable.
      expect(h.domain.table('inquiries').get('inquiry-live')).toMatchObject({ question: 'q', purpose: 'p', target: { sessionId: 'child-b' } })
      expect(claims.find(value => value.messageId === delivered.messageId)).toBeDefined()
      expect(target.inbox.nextTurn.map((message: { id: string }) => message.id)).not.toContain(delivered.messageId)
    } catch (error) {
      payloadReject(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      for (const dispose of disposers.reverse()) dispose()
      await ctx.fiber.dispose()
      await h.close()
    }
  })

  it('composes a model-issued nested inquiry through B to C while retaining A root work and audience', async () => {
    const h = await openPetHarness()
    const ctx = new Context()
    for (const plugin of [Sessions, Agents, Llm, SystemPrompt, ToolRuntime, Projections]) await ctx.plugin(plugin)
    const guiMessage = createUserMessage({ content: [{ type: 'text', text: 'A root work: ask B, then B may ask C.' }], source: { kind: 'user' } })
    const claims: Array<{ agentId: string; turn: number; messageId: string }> = []
    const mountedGuards = new Set<string>()
    let nestedObserved!: (value: { parentId: string; nestedId: string; nested: Record<string, unknown>; root: Record<string, unknown>; targetBody: Record<string, unknown> }) => void
    let nestedFailed!: (error: Error) => void
    const observed = new Promise<{ parentId: string; nestedId: string; nested: Record<string, unknown>; root: Record<string, unknown>; targetBody: Record<string, unknown> }>((resolve, reject) => { nestedObserved = resolve; nestedFailed = reject })
    const holdC = Promise.withResolvers<void>()
    const targetRef = 'child:c:1:child-c'
    class NestedLlm extends LlmAdapter {
      private count = 0
      constructor(private readonly role: 'main' | 'b' | 'c') { super() }
      async *stream(request: { messages: Array<{ content?: Array<{ type: string; text?: string }> }> }) {
        const emitCall = async function* (id: string, name: string, args: Record<string, unknown>) {
          const block = { type: 'tool-call', id, name, arguments: JSON.stringify(args) }
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: block.arguments }
          yield { type: 'block-end', index: 0, block }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        }
        const textBlocks = request.messages.flatMap(message => message.content ?? []).filter(block => block.type === 'text').map(block => {
          try { return JSON.parse(block.text ?? '') as Record<string, unknown> } catch { return undefined }
        }).filter((value): value is Record<string, unknown> => !!value)
        if (this.role === 'main') {
          if (this.count++ === 0) { yield* emitCall('root-call', 'pet_inquire', { target: 'child:b:1:child-b', question: 'Ask B to ask C the question.', purpose: 'Continue A root work' }); return }
          yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text: 'done' }; yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }; yield { type: 'finish', reason: { kind: 'stop' } }; return
        }
        if (this.role === 'b') {
          const parentBody = textBlocks.find(value => typeof value.inquiryId === 'string' && typeof value.question === 'string')
          if (!parentBody) throw new Error('B did not receive parent inquiry JSON')
          yield* emitCall('nested-call', 'pet_inquire', { target: targetRef, question: `C question derived from: ${parentBody.question}`, purpose: 'Continue the parent inquiry' }); return
        }
        try {
          const nestedBody = textBlocks.find(value => typeof value.inquiryId === 'string' && typeof value.question === 'string' && typeof value.purpose === 'string')
          if (!nestedBody) throw new Error('C did not receive nested inquiry JSON')
          const nestedId = String(nestedBody.inquiryId)
          const nested = h.domain.table('inquiries').get(nestedId) as Record<string, unknown>
          const parentId = String((nested.origin as { parentInquiryId: string }).parentInquiryId)
          const root = h.domain.table('inquiries').get(parentId) as Record<string, unknown>
          const handoff = h.domain.table('inquiry_handoffs').get(JSON.stringify([nestedId, 'target'])) as { state: string; messageId: string }
          const claim = claims.find(value => value.agentId === 'child-c' && value.messageId === handoff?.messageId)
          if (nested.status !== 'executing' || handoff?.state !== 'claimed' || !claim) throw new Error('C nested handoff was not claimed before its model ran')
          nestedObserved({ parentId, nestedId, nested, root, targetBody: nestedBody })
        } catch (error) { nestedFailed(error instanceof Error ? error : new Error(String(error))); throw error }
        // Keep C claimed until the snapshot assertions finish, then let the real stream drain.
        await holdC.promise
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'done' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const disposers: Array<() => void> = []
    try {
      for (const role of ['main', 'b', 'c'] as const) ctx.llm.registerAdapter([`nested-${role}`], new NestedLlm(role))
      await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
      const agents = new Map<string, Awaited<ReturnType<typeof ctx.agentLoop.create>>>()
      for (const [id, role] of [['main', 'main'], ['child-b', 'b'], ['child-c', 'c']] as const) agents.set(id, await ctx.agentLoop.create(id, { provider: `nested-${role}`, model: 'm' }))
      const scopes = new Map<string, import('../src/host/inquiry/ledger.js').InquiryScope>([
        ['main', { kind: 'main', sessionId: 'main' }], ['child-b', { kind: 'child', sessionId: 'child-b', locusId: 'b', generation: 1 }], ['child-c', { kind: 'child', sessionId: 'child-c', locusId: 'c', generation: 1 }],
      ])
      const locusB = buildLocusRecord({ id: 'b', generation: 1, parentSessionId: 'main', childSessionId: 'child-b', endpoint: { chatId: 'chat-b' }, workspaceId: 'ws', source: 'explicit', state: 'active' })
      const locusC = buildLocusRecord({ id: 'c', generation: 1, parentSessionId: 'main', childSessionId: 'child-c', endpoint: { chatId: 'chat-c' }, workspaceId: 'ws', source: 'explicit', state: 'active' })
      const loci = [locusB, locusC]
      const identities = new Map([['main', { id: 'main' }], ['child-b', { id: 'child-b', parentSessionId: 'main' }], ['child-c', { id: 'child-c', parentSessionId: 'main' }]])
      const ports = { loci: { findByChildSessionId: (id: string) => loci.filter(x => x.childSessionId === id), getLocusByChild: (id: string) => loci.find(x => x.childSessionId === id), listLociByParent: (id: string) => id === 'main' ? loci : [], getCurrentLocus: (endpoint: { chatId: string; threadId?: string }) => loci.find(x => x.endpoint.chatId === endpoint.chatId && x.endpoint.threadId === endpoint.threadId) }, inspect: async (id: string) => identities.get(id), isArchived: () => false, hasPublicContext: () => true }
      const resolveAgent = (s: { sessionId: string }) => agents.get(s.sessionId)
      for (const [id, agent] of agents) { agent.ctx.tools.guard((execution: { name: string }) => execution.name === 'pet_inquire' || execution.name === 'pet_inquiry_answer' ? undefined : `fixture denies ${id}`); mountedGuards.add(id) }
      const composed = composeProductionInquiry({ domain: h.domain as never, currentScope: (id: string) => scopes.get(id), resolveAgent: resolveAgent as never, agentLoop: ctx.agentLoop, probeIsolatedClaim: ctx.agentLoop.probeIsolatedQueuedTurnClaim.bind(ctx.agentLoop), tools: ctx.tools, readinessManagedGuard: () => mountedGuards.size === 3, log: () => undefined, onError: (error: unknown) => nestedFailed(error instanceof Error ? error : new Error(String(error))), now: () => 1_800_000_000_000, newMessageId: (() => { let n = 0; return () => `nested-message-${++n}` })(), newInquiryId: (() => { let n = 0; return () => `nested-inquiry-${++n}` })() })
      expect(composed.ready).toBe(true)
      for (const agent of agents.values()) composed.install(agent as Agent)
      for (const id of ['main', 'child-b']) {
        const agent = agents.get(id)!
        disposers.push(registerInquiryAskTool(agent.ctx, { forExecution: execution => { const bound = composed.forExecution(execution as never); return { ports: ports as never, store: { accept: bound.accept }, origin: bound.origin, ready: () => composed.ready, now: () => 1_800_000_000_000, newInquiryId: (() => { let n = 0; return () => `fixture-id-${id}-${++n}` })() } } }))
      }
      ctx.on('agent/inbox/claimed', (event: { agent: { id: string }; turn: number; message: { id: string } }) => claims.push({ agentId: event.agent.id, turn: event.turn, messageId: event.message.id }))
      agents.get('main')!.followup(guiMessage)
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([observed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('nested C target timed out')), 8000) })]).finally(() => { if (timer) clearTimeout(timer) })
      const nested = result.nested as { requester: { sessionId: string }; origin: { kind: string; parentInquiryId: string }; audience: Record<string, unknown>; trace: { rootInquiryId: string } }
      const root = result.root as { id: string; requester: { sessionId: string }; trace: { rootInquiryId: string }; status: string }
      expect(nested.requester.sessionId).toBe('child-b')
      expect(nested.origin).toEqual({ kind: 'inquiry', parentInquiryId: result.parentId })
      expect(nested.trace.rootInquiryId).toBe(root.id)
      expect(root.trace.rootInquiryId).toBe(root.id)
      expect(nested.audience).toEqual({ kind: 'local-session', sessionId: 'main' })
      expect(root.requester.sessionId).toBe('main')
      expect(result.targetBody.question).toContain('C question derived from:')
      expect(h.domain.table('inquiry_works').get(JSON.stringify(['main', guiMessage.id]))).toMatchObject({ openInquiryIds: [result.parentId, result.nestedId] })
      expect([...h.domain.table('inquiries').entries()]).toHaveLength(2)
    } catch (error) { nestedFailed(error instanceof Error ? error : new Error(String(error))); throw error }
    finally { holdC.resolve(); for (const dispose of disposers.reverse()) dispose(); await ctx.fiber.dispose(); await h.close() }
  })

  it.each([
    { direction: 'parent → child → parent', requesterId: 'main', targetId: 'child-b' },
    { direction: 'child → parent → child', requesterId: 'child-b', targetId: 'main' },
  ])('runs a full registered $direction answer/result continuation', async ({ requesterId, targetId }) => {
    const targetRef = requesterId === 'main' ? 'child:b:1:child-b' : 'main:main'
    const h = await openPetHarness()
    const ctx = new Context()
    for (const plugin of [Sessions, Agents, Llm, SystemPrompt, ToolRuntime, Projections]) await ctx.plugin(plugin)
    let resultResolve!: (value: { inquiryId: string; answer: string; resultTurn: number; messageId: string; rootContinuationTurn: number }) => void
    let resultReject!: (error: Error) => void
    const resultDelivered = new Promise<{ inquiryId: string; answer: string; resultTurn: number; messageId: string; rootContinuationTurn: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('inquiry result timed out')), 9000)
      const settle = (value: { inquiryId: string; answer: string; resultTurn: number; messageId: string; rootContinuationTurn: number }) => { clearTimeout(timer); resolve(value) }
      resultResolve = settle
      resultReject = reject
    })
    const guiMessage = createUserMessage({ content: [{ type: 'text', text: 'ask target and continue with its result' }], source: { kind: 'user' } })
    const claims: Array<{ agentId: string; turn: number; messageId: string }> = []
    const mountedGuards = new Set<string>()
    const inquireErrors: Array<{ isError: boolean; text: string }> = []
    const inquiryIds: string[] = []
    let cycleAttemptedAtResult = false
    let cycleOrigin: unknown
    let cycleFacts: unknown
    const originalAcceptContexts: Array<{ callId?: string; origin: unknown }> = []
    let inquirySequence = 0
    const nextInquiryId = () => `full-inquiry-${++inquirySequence}`
    class FullFakeLlm extends LlmAdapter {
      private count = 0
      constructor(private readonly role: 'requester' | 'target') { super() }
      async *stream(request: { messages: Array<{ content?: Array<{ type: string; text?: string }> }> }) {
        if (this.role === 'target' && this.count++ === 0) {
          const texts = request.messages.flatMap(message => message.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '')
          const handoff = h.domain.table('inquiry_handoffs').entries().map(([, value]) => value as { inquiryId: string; phase: string; messageId: string; state: string; claimTurn?: number }).find(value => value.phase === 'target')!
          const parsed = texts.map(text => { try { return JSON.parse(text) as Record<string, unknown> } catch { return undefined } }).find(value => value?.inquiryId === handoff.inquiryId && value?.question)
          expect(parsed).toBeDefined()
          const answerCall = { type: 'tool-call', id: 'target-answer-1', name: 'pet_inquiry_answer', arguments: JSON.stringify({ inquiryId: handoff.inquiryId, answer: 'The actual target verified the production value.', confidence: 'confirmed', recency: 'current', sources: ['proof'] }) }
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id: answerCall.id, name: answerCall.name, argumentsDelta: answerCall.arguments }
          yield { type: 'block-end', index: 0, block: answerCall }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } else if (this.role === 'requester' && this.count++ === 0) {
          const call = { type: 'tool-call', id: 'root-inquire-1', name: 'pet_inquire', arguments: JSON.stringify({ target: targetRef, question: 'What is the production value?', purpose: 'Continue the original work accurately' }) }
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments }
          yield { type: 'block-end', index: 0, block: call }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } else {
          if (this.role === 'requester') {
            const result = request.messages.flatMap(message => message.content ?? []).filter(block => block.type === 'text').map(block => {
              try { return JSON.parse(block.text ?? '') as Record<string, unknown> } catch { return undefined }
            }).find(value => value?.purpose === 'inquiry-result' && typeof value.answer === 'string')
            if (result && !cycleAttemptedAtResult) {
              try {
                cycleAttemptedAtResult = true
                const handoff = h.domain.table('inquiry_handoffs').entries().map(([, value]) => value as { inquiryId: string; phase: string; messageId: string; state: string; claimTurn?: number }).find(value => value.phase === 'result')!
                const claim = claims.find(value => value.agentId === requesterId && value.messageId === handoff.messageId)
                const work = [...h.domain.table('inquiry_works').entries()].map(([, value]) => value as { workId: string; sessionId: string; state: string; continuationTurn: number | null }).find(value => value.workId === guiMessage.id && value.sessionId === requesterId)
                const targetHandoff = h.domain.table('inquiry_handoffs').entries().map(([, value]) => value as { inquiryId: string; phase: string; messageId: string }).find(value => value.phase === 'target' && value.inquiryId === handoff.inquiryId)!
                expect(new Set([guiMessage.id, targetHandoff.messageId, handoff.messageId]).size).toBe(3)
                expect(result.inquiryId).toBe(handoff.inquiryId)
                expect(h.domain.table('inquiries').get(handoff.inquiryId)).toMatchObject({ status: 'result-delivered' })
                expect(handoff.state).toBe('claimed')
                expect(claim).toBeDefined()
                expect(handoff.claimTurn).toBe(claim!.turn)
                expect(work?.state).toBe('active')
                expect(work?.continuationTurn).toBe(claim!.turn)
                resultResolve({ inquiryId: String(result.inquiryId), answer: String(result.answer), resultTurn: claim!.turn, messageId: handoff.messageId, rootContinuationTurn: work!.continuationTurn! })
                const call = { type: 'tool-call', id: 'nested-repeat', name: 'pet_inquire', arguments: JSON.stringify({ target: targetRef, question: 'Ask that member again?', purpose: 'Test inherited chain state' }) }
                yield { type: 'block-start', index: 0, blockType: 'tool-call' }
                yield { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments }
                yield { type: 'block-end', index: 0, block: call }
                yield { type: 'finish', reason: { kind: 'tool-calls' } }
                return
              } catch (error) { resultReject(error instanceof Error ? error : new Error(String(error))); throw error }
            }
            if (result && cycleAttemptedAtResult) {
              try { expect(result.inquiryId).toBe(inquiryIds[0]) }
              catch (error) { resultReject(error instanceof Error ? error : new Error(String(error))); throw error }
            }
          }
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'continued' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'continued' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
    }
    const disposers: Array<() => void> = []
    let removeWorkListener: (() => void) | undefined
    let settleWorkTimer: ReturnType<typeof setTimeout> | undefined
    try {
      ctx.llm.registerAdapter(['fullasker'], new FullFakeLlm('requester'))
      ctx.llm.registerAdapter(['fulltarget'], new FullFakeLlm('target'))
      await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
      const agentsById = new Map<string, Awaited<ReturnType<typeof ctx.agentLoop.create>>>()
      agentsById.set('main', await ctx.agentLoop.create('main', { provider: requesterId === 'main' ? 'fullasker' : 'fulltarget', model: 'm' }))
      agentsById.set('child-b', await ctx.agentLoop.create('child-b', { provider: requesterId === 'child-b' ? 'fullasker' : 'fulltarget', model: 'm' }))
      const asker = agentsById.get(requesterId)!
      const target = agentsById.get(targetId)!
      const scopes = new Map<string, import('../src/host/inquiry/ledger.js').InquiryScope>([['main', { kind: 'main', sessionId: 'main' }], ['child-b', { kind: 'child', sessionId: 'child-b', locusId: 'b', generation: 1 }]])
      const locus = buildLocusRecord({ id: 'b', generation: 1, parentSessionId: 'main', childSessionId: 'child-b', endpoint: { chatId: 'chat-b' }, workspaceId: 'ws', source: 'explicit', state: 'active' })
      const identities = new Map([['main', { id: 'main' }], ['child-b', { id: 'child-b', parentSessionId: 'main' }]])
      const collaborationPorts = { loci: {
        findByChildSessionId: (id: string) => id === 'child-b' ? [locus] : [], getLocusByChild: (id: string) => id === 'child-b' ? locus : undefined,
        listLociByParent: (id: string) => id === 'main' ? [locus] : [],
        getCurrentLocus: (endpoint: { chatId: string; threadId?: string }) => endpoint.chatId === locus.endpoint.chatId && endpoint.threadId === locus.endpoint.threadId ? locus : undefined,
      }, inspect: async (id: string) => identities.get(id), isArchived: () => false, hasPublicContext: () => true }
      const resolveAgent = (scope: { sessionId: string }) => agentsById.get(scope.sessionId)
      for (const [agent, id] of [[asker, requesterId], [target, targetId]] as const) { agent.ctx.tools.guard((execution: { name: string }) => execution.name === 'pet_inquire' || execution.name === 'pet_inquiry_answer' ? undefined : `fixture denies ${id}`); mountedGuards.add(id) }
      const composed = composeProductionInquiry({ domain: h.domain as never, currentScope: (id: string) => scopes.get(id), resolveAgent: resolveAgent as never, agentLoop: ctx.agentLoop,
        probeIsolatedClaim: ctx.agentLoop.probeIsolatedQueuedTurnClaim.bind(ctx.agentLoop), tools: ctx.tools, readinessManagedGuard: () => mountedGuards.size === 2,
        log: () => undefined, onError: (error: unknown) => resultReject(error instanceof Error ? error : new Error(String(error))), now: () => 1_800_000_000_000,
        newMessageId: (() => { let n = 0; return () => `full-message-${++n}` })(), newInquiryId: nextInquiryId })
      expect(composed.ready).toBe(true)
      composed.install(asker as Agent); composed.install(target as Agent)
      disposers.push(registerInquiryAskTool(asker.ctx, { forExecution: execution => {
        const bound = composed.forExecution(execution as never)
        const actualOrigin = bound.origin
        return { ports: collaborationPorts as never, store: { accept: async (request: unknown, facts: unknown) => {
          const origin = actualOrigin((execution as { agent?: { id?: string } }).agent!.id!)
          originalAcceptContexts.push({ callId: (execution as { callId?: string }).callId, origin })
          if (origin && (origin as { origin?: { kind?: string; parentInquiryId?: string } }).origin?.kind === 'inquiry') {
            cycleOrigin = origin
            cycleFacts = facts
          }
          const factId = (facts as { inquiryId?: string }).inquiryId
          if (typeof factId === 'string') inquiryIds.push(factId)
          return bound.accept(request as never, facts as never)
        } }, origin: bound.origin, ready: () => composed.ready, now: () => 1_800_000_000_000, newInquiryId: nextInquiryId }
      } }))
      const { InquiryLedgerStore } = await import('../src/host/inquiry/ledger-store.js')
      target.ctx.on('tools/result', (execution: { name: string }, result: { isError: boolean; content: Array<{ type: string; text?: string }> }) => { if (execution.name === 'pet_inquiry_answer' && result.isError) resultReject(new Error(`answer receipt error=${result.isError}: ${result.content.map(block => block.text ?? '').join(' ')}`)) })
      const ledger = new InquiryLedgerStore(h.domain as never)
      disposers.push(registerInquiryAnswerTool(target.ctx, { ports: collaborationPorts as never, ledger: ledger as never, answers: composed.answerStore,
        commitAnswer: (candidate, eventId) => composed.answerStore.commit(candidate, eventId),
        binding: (sessionId, inquiryId, execution) => composed.answerBinding(sessionId, inquiryId, execution as never), afterAnswer: composed.afterAnswer,
        now: () => 1_800_000_000_000, newEventId: (() => { let n = 0; return () => `answer-event-${++n}` })() }))
      ctx.on('agent/inbox/claimed', (event: { agent: { id: string }; turn: number; message: { id: string } }) => claims.push({ agentId: event.agent.id, turn: event.turn, messageId: event.message.id }))
      const workSettled = new Promise<void>((resolve, reject) => {
        const key = JSON.stringify([requesterId, guiMessage.id])
        const listener = (change: { table?: string; key?: string; operation?: string; value?: { state?: string } }) => {
          if (change.table === 'inquiry_works' && change.key === key && change.operation === 'put' && change.value?.state === 'settled') resolve()
        }
        removeWorkListener = h.ctx.on('domain/changed', listener)
        settleWorkTimer = setTimeout(() => reject(new Error('production inquiry work did not reach durable settled state after 9s')), 9000)
      })
      asker.followup(guiMessage)
      asker.ctx.on('tools/result', (execution: { name: string; callId?: string }, result: { isError: boolean; content: Array<{ type: string; text?: string }> }) => {
        if (execution.name === 'pet_inquire') inquireErrors.push({ isError: result.isError, text: result.content.map(block => block.text ?? '').join(' ') })
      })
      const delivered = await resultDelivered
      await Promise.all([asker.whenIdle(), target.whenIdle()])
      await workSettled.finally(() => {
        if (settleWorkTimer) clearTimeout(settleWorkTimer)
        removeWorkListener?.()
        settleWorkTimer = undefined
        removeWorkListener = undefined
      })
      const inquiry = h.domain.table('inquiries').get(delivered.inquiryId) as { status: string }
      const answer = h.domain.table('inquiry_answers').get(delivered.inquiryId) as { answer: string; answeredBy: { sessionId: string } }
      const work = h.domain.table('inquiry_works').get(JSON.stringify([requesterId, guiMessage.id])) as { state: string; openInquiryIds: string[] }
      expect(answer).toMatchObject({ answer: 'The actual target verified the production value.', answeredBy: { sessionId: targetId } })
      expect(inquiry.status).toBe('result-delivered')
      expect(work).toMatchObject({ state: 'settled', openInquiryIds: [] })
      expect(claims.filter(value => value.agentId === requesterId).map(value => value.turn)).toContain(delivered.resultTurn)
      expect(cycleAttemptedAtResult).toBe(true)
      expect(cycleOrigin).toMatchObject({ origin: { kind: 'inquiry', parentInquiryId: inquiryIds[0] } })
      expect(inquiryIds).toHaveLength(2)
      expect(new Set(inquiryIds).size).toBe(2)
      expect(originalAcceptContexts).toHaveLength(2)
      expect(inquireErrors).toHaveLength(2)
      expect(inquireErrors[0]?.isError).toBe(false)
      expect(inquireErrors[1]?.isError).toBe(true)
      expect(inquireErrors[1]?.text).toMatch(/already on the current inquiry chain/i)
      expect((cycleFacts as { origin?: unknown })?.origin).toMatchObject({ kind: 'inquiry', parentInquiryId: inquiryIds[0] })
      expect([...h.domain.table('inquiries').entries()].length).toBe(1)
      expect(claims.find(value => value.agentId === targetId && value.messageId !== guiMessage.id)).toBeDefined()
    } catch (error) { resultReject(error instanceof Error ? error : new Error(String(error))); throw error }
    finally { if (settleWorkTimer) clearTimeout(settleWorkTimer); removeWorkListener?.(); for (const dispose of disposers.reverse()) dispose(); await ctx.fiber.dispose(); await h.close() }
  })

  it('settles the requester work with an explicit no-answer failure when the target ends without answering', async () => {
    const h = await openPetHarness()
    const ctx = new Context()
    for (const plugin of [Sessions, Agents, Llm, SystemPrompt, ToolRuntime, Projections]) await ctx.plugin(plugin)
    const guiMessage = createUserMessage({ content: [{ type: 'text', text: 'Ask the target, then report the result.' }], source: { kind: 'user' } })
    const requesterId = 'main'
    const targetId = 'child-b'
    const targetRef = 'child:b:1:child-b'
    const claims: Array<{ agentId: string; turn: number; messageId: string }> = []
    const inquiryErrors: Array<{ isError: boolean; text: string }> = []
    const mountedGuards = new Set<string>()
    let askerFinalReply = ''
    let targetTurns = 0
    let requesterTurns = 0
    class NoAnswerLlm extends LlmAdapter {
      constructor(private readonly role: 'requester' | 'target') { super() }
      async *stream() {
        if (this.role === 'requester' && requesterTurns++ === 0) {
          const call = { type: 'tool-call', id: 'no-answer-inquire', name: 'pet_inquire', arguments: JSON.stringify({ target: targetRef, question: 'What is the production value?', purpose: 'Report the target result' }) }
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments }
          yield { type: 'block-end', index: 0, block: call }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        if (this.role === 'target') {
          targetTurns++
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'I cannot answer.' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'I cannot answer.' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        const text = 'The target could not provide an answer.'
        askerFinalReply = text
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const disposers: Array<() => void> = []
    let removeWorkListener: (() => void) | undefined
    let settleWorkTimer: ReturnType<typeof setTimeout> | undefined
    try {
      ctx.llm.registerAdapter(['noanswerasker'], new NoAnswerLlm('requester'))
      ctx.llm.registerAdapter(['noanswertarget'], new NoAnswerLlm('target'))
      await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
      const agentsById = new Map<string, Awaited<ReturnType<typeof ctx.agentLoop.create>>>()
      agentsById.set(requesterId, await ctx.agentLoop.create(requesterId, { provider: 'noanswerasker', model: 'm' }))
      agentsById.set(targetId, await ctx.agentLoop.create(targetId, { provider: 'noanswertarget', model: 'm' }))
      const asker = agentsById.get(requesterId)!
      const target = agentsById.get(targetId)!
      const scopes = new Map<string, import('../src/host/inquiry/ledger.js').InquiryScope>([['main', { kind: 'main', sessionId: 'main' }], ['child-b', { kind: 'child', sessionId: 'child-b', locusId: 'b', generation: 1 }]])
      const locus = buildLocusRecord({ id: 'b', generation: 1, parentSessionId: 'main', childSessionId: 'child-b', endpoint: { chatId: 'chat-b' }, workspaceId: 'ws', source: 'explicit', state: 'active' })
      const identities = new Map([['main', { id: 'main' }], ['child-b', { id: 'child-b', parentSessionId: 'main' }]])
      const collaborationPorts = { loci: {
        findByChildSessionId: (id: string) => id === 'child-b' ? [locus] : [], getLocusByChild: (id: string) => id === 'child-b' ? locus : undefined,
        listLociByParent: (id: string) => id === 'main' ? [locus] : [],
        getCurrentLocus: (endpoint: { chatId: string; threadId?: string }) => endpoint.chatId === locus.endpoint.chatId && endpoint.threadId === locus.endpoint.threadId ? locus : undefined,
      }, inspect: async (id: string) => identities.get(id), isArchived: () => false, hasPublicContext: () => true }
      const resolveAgent = (scope: { sessionId: string }) => agentsById.get(scope.sessionId)
      for (const [agent, id] of [[asker, requesterId], [target, targetId]] as const) { agent.ctx.tools.guard((execution: { name: string }) => execution.name === 'pet_inquire' || execution.name === 'pet_inquiry_answer' ? undefined : `fixture denies ${id}`); mountedGuards.add(id) }
      const composed = composeProductionInquiry({ domain: h.domain as never, currentScope: (id: string) => scopes.get(id), resolveAgent: resolveAgent as never, agentLoop: ctx.agentLoop,
        probeIsolatedClaim: ctx.agentLoop.probeIsolatedQueuedTurnClaim.bind(ctx.agentLoop), tools: ctx.tools, readinessManagedGuard: () => mountedGuards.size === 2,
        log: () => undefined, onError: (error: unknown) => { throw error }, now: () => 1_800_000_000_000,
        newMessageId: (() => { let n = 0; return () => `no-answer-message-${++n}` })(), newInquiryId: () => 'no-answer-inquiry' })
      expect(composed.ready).toBe(true)
      composed.install(asker as Agent); composed.install(target as Agent)
      disposers.push(registerInquiryAskTool(asker.ctx, { forExecution: execution => {
        const bound = composed.forExecution(execution as never)
        return { ports: collaborationPorts as never, store: { accept: bound.accept }, origin: bound.origin, ready: () => composed.ready, now: () => 1_800_000_000_000, newInquiryId: () => 'no-answer-inquiry' }
      } }))
      const { InquiryLedgerStore } = await import('../src/host/inquiry/ledger-store.js')
      const ledger = new InquiryLedgerStore(h.domain as never)
      disposers.push(registerInquiryAnswerTool(target.ctx, { ports: collaborationPorts as never, ledger: ledger as never, answers: composed.answerStore,
        commitAnswer: (candidate, eventId) => composed.answerStore.commit(candidate, eventId),
        binding: (sessionId, inquiryId, execution) => composed.answerBinding(sessionId, inquiryId, execution as never), afterAnswer: composed.afterAnswer,
        now: () => 1_800_000_000_000, newEventId: () => 'no-answer-event' }))
      ctx.on('agent/inbox/claimed', (event: { agent: { id: string }; turn: number; message: { id: string } }) => claims.push({ agentId: event.agent.id, turn: event.turn, messageId: event.message.id }))
      const workSettled = new Promise<void>((resolve, reject) => {
        const key = JSON.stringify([requesterId, guiMessage.id])
        const listener = (change: { table?: string; key?: string; operation?: string; value?: { state?: string } }) => {
          if (change.table === 'inquiry_works' && change.key === key && change.operation === 'put' && change.value?.state === 'settled') resolve()
        }
        removeWorkListener = h.ctx.on('domain/changed', listener)
        settleWorkTimer = setTimeout(() => reject(new Error('no-answer inquiry work did not reach durable settled state after 9s')), 9000)
      })
      asker.ctx.on('tools/result', (execution: { name: string }, result: { isError: boolean; content: Array<{ type: string; text?: string }> }) => {
        if (execution.name === 'pet_inquire') inquiryErrors.push({ isError: result.isError, text: result.content.map(block => block.text ?? '').join(' ') })
      })
      asker.followup(guiMessage)
      await Promise.all([asker.whenIdle(), target.whenIdle()])
      await workSettled.finally(() => {
        if (settleWorkTimer) clearTimeout(settleWorkTimer)
        removeWorkListener?.()
        settleWorkTimer = undefined
        removeWorkListener = undefined
      })
      const inquiry = h.domain.table('inquiries').get('no-answer-inquiry') as { status: string; reason?: string }
      const work = h.domain.table('inquiry_works').get(JSON.stringify([requesterId, guiMessage.id])) as { state: string; openInquiryIds: string[] }
      const outbox = [...h.domain.table('inquiry_results').entries()].map(([, value]) => value as { inquiryId: string; status: string; result?: Record<string, unknown> }).find(value => value.inquiryId === 'no-answer-inquiry')
      expect(targetTurns).toBe(1)
      expect(claims.find(value => value.agentId === targetId && value.messageId !== guiMessage.id)).toBeDefined()
      expect(inquiry).toMatchObject({ status: 'unavailable', reason: 'inquiry-no-explicit-answer' })
      expect(work).toMatchObject({ state: 'settled', openInquiryIds: [] })
      expect(outbox).toMatchObject({ status: 'delivered', result: { kind: 'failure', failure: 'unavailable', reason: 'inquiry-no-explicit-answer' } })
      expect(inquiryErrors).toEqual([{ isError: false, text: expect.stringContaining('no-answer-inquiry') }])
      expect(askerFinalReply).toBe('The target could not provide an answer.')
    } finally {
      if (settleWorkTimer) clearTimeout(settleWorkTimer)
      removeWorkListener?.()
      for (const dispose of disposers.reverse()) dispose()
      await ctx.fiber.dispose()
      await h.close()
    }
  })
})
