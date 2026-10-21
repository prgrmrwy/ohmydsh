import { describe, expect, it, vi } from 'vitest'
import { LocusRepository } from '../src/host/locus/persistence.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Projections from '@deepseek-ai/dsh-session-projection'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LOCUS_ROUTES } from '../src/wire.js'
import { CHILD_A, MAIN, loadPetHost, locus } from './support/pet-host-fixture.js'

const launcher = process.env.PET_INQUIRY_LAUNCHER
if (!launcher) throw new Error('PET_INQUIRY_LAUNCHER must be set; run with vitest.inquiry-wiring.config.ts')

async function ownerInquiry(host: Awaited<ReturnType<typeof loadPetHost>>) {
  const route = host.route(LOCUS_ROUTES.view)
  expect(route, 'plugin-mounted locus owner view route').toBeDefined()
  let payload: { ok: boolean; data?: { loci?: { owner?: { inquiry?: { dispatchCapability?: string } } }[] } } | undefined
  await route!.handler({ method: 'GET', headers: { host: '127.0.0.1:3080' } } as never, {
    writeHead() { return this }, end(text?: string) { payload = JSON.parse(text ?? 'null') },
  } as never)
  expect(payload?.ok).toBe(true)
  return payload?.data?.loci?.find(item => item.owner?.inquiry)?.owner?.inquiry?.dispatchCapability
}

async function installLoop(ctx: Parameters<NonNullable<Parameters<typeof loadPetHost>[3]>>[0]) {
  await ctx.plugin(Projections)
  const agents = ctx.get('agents') as object
  Object.assign(agents, { setFactory: () => () => {} })
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
}

const waitForWiring = () => new Promise(resolve => setTimeout(resolve, 100))

async function executeInquiry(host: Awaited<ReturnType<typeof loadPetHost>>, agent: { id: string }) {
  return host.ctx.tools.execute({
    name: 'pet_inquire', agent, callId: 'wiring-inquiry' as never,
    arguments: { target: 'valid-shaped-target', question: 'What is the status?', purpose: 'Need status for coordination.' },
    signal: new AbortController().signal,
  })
}

function inquiryRows(host: Awaited<ReturnType<typeof loadPetHost>>) {
  const facility = host.ctx.get('storageDomain') as { get(name: string): { table(name: string): { entries(): IterableIterator<[string, unknown]> } } | undefined }
  const domain = facility.get('dsh_pet')
  expect(domain, 'opened Pet domain').toBeDefined()
  return [...domain!.table('inquiries').entries()]
}

describe('production inquiry wiring through the Pet plugin entry', () => {
  it.each(['associated', 'gui-only', 'stale-a', 'no-current', 'multiple-current', 'generation-changed'] as const)('wires %s refused finish safely through the actual plugin and idle boundary', async mode => {
    const host = await loadPetHost([locus('a', CHILD_A)], undefined, undefined, installLoop)
    try {
      const child = await host.agentScope(CHILD_A)
      const main = await host.agentScope(MAIN)
      host.publish(MAIN, main.scope)
      const facility = host.ctx.get('storageDomain') as { get(name: string): never }
      const repository = new LocusRepository(facility.get('dsh_pet'))
      const row = repository.getLocus('a')!
      const scope = { endpoint: row.endpoint, locusId: row.id, generation: row.generation, childSessionId: CHILD_A }
      const message = createUserMessage({ content: [{ type: 'text', text: 'test delivery' }], source: { kind: 'user' } })
      const accepted = await repository.acceptDelivery({ ...scope, messageId: 'platform-a', senderOpenId: 'ou-test', acceptedAt: Date.now() })
      await repository.claimCurrentDelivery({ correlation: scope, now: Date.now() })
      await repository.bindQueued({ deliveryId: accepted.record.deliveryId, correlation: scope, executionId: 'execution-test', inboxMessageId: message.id, queuedAt: Date.now() })
      const idle = Promise.withResolvers<void>()
      const idleWait = vi.fn(() => idle.promise)
      const actor = { id: CHILD_A, ctx: child.scope, session: { id: CHILD_A, header: { id: CHILD_A, cwd: '/test' }, inheritedEventCount: 0, snapshotEvents: () => [] }, inbox: { nextTurn: [], nextStep: [] }, status: 'running', followup: vi.fn(), whenIdle: idleWait }
      host.ctx.emit('agent/created' as never, { agent: actor } as never)
      if (mode !== 'gui-only') host.ctx.emit('agent/inbox/claimed' as never, { agent: actor, message, turn: 1 } as never)
      host.ctx.emit('agent/inbox/claimed' as never, { agent: actor, message: { id: 'non-routing-foreign', source: { kind: 'schedule' } }, turn: 1 } as never)
      await host.ctx.waterfall('agent/pre-step' as never, { agent: actor, messages: [message], turn: 1, step: 1 } as never, async () => ({ kind: 'continue' }) as never)
      if (mode === 'stale-a' || mode === 'no-current') {
        await repository.expireCurrentDelivery({ ...scope, deliveryId: accepted.record.deliveryId, now: Date.now() + 3_600_000 })
        if (mode === 'stale-a') {
          await repository.acceptDelivery({ ...scope, messageId: 'platform-b', senderOpenId: 'ou-test', acceptedAt: Date.now() })
          await repository.claimCurrentDelivery({ correlation: scope, now: Date.now() })
        }
      }
      const expectedStatus = mode === 'stale-a' || mode === 'no-current' ? 'expired' : 'current'
      if (mode === 'multiple-current') {
        const duplicate = await repository.acceptDelivery({ ...scope, messageId: 'platform-duplicate', senderOpenId: 'ou-test', acceptedAt: Date.now() })
        const domain = facility.get('dsh_pet') as { table(name: string): { put(id: string, row: unknown): Promise<void> } }
        await domain.table('locus_deliveries').put(duplicate.record.deliveryId, { ...duplicate.record, status: 'current', queueState: 'current' })
      }
      const result = await host.ctx.tools.execute({ name: 'pet_locus_finish', agent: Object.assign(child.key, actor) as never, callId: 'finish-test' as never, arguments: { outcome: 'reply', text: 'must not send' }, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('This operation is not authorized for the current request.')
      expect(repository.getDelivery(accepted.record.deliveryId)?.status).toBe(expectedStatus)
      if (mode === 'generation-changed') await repository.invalidateLocus(row.id, 'test-generation-invalidated', Date.now(), undefined, { evenWithPendingWork: true })
      host.ctx.emit('session/event' as never, actor.session as never, { type: 'turn/end', seq: 0, data: { turn: 1, reason: { kind: 'completed' } } } as never)
      await vi.waitFor(() => expect(idleWait).toHaveBeenCalled())
      expect(repository.getDelivery(accepted.record.deliveryId)?.status).toBe(expectedStatus)
      actor.status = 'idle'
      idle.resolve()
      if (mode === 'associated') {
        await vi.waitFor(() => expect(repository.getDelivery(accepted.record.deliveryId)).toMatchObject({ status: 'failed', failureReason: 'reply-refused' }))
      } else {
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(repository.getDelivery(accepted.record.deliveryId)?.status).toBe(expectedStatus)
        if (mode === 'stale-a') expect(repository.listDeliveries().find(record => record.messageId === 'platform-b')?.status).toBe('current')
      }
      expect(actor.followup).not.toHaveBeenCalled()
    } finally { await host.close() }
  })

  it('keeps inquiry dispatch unavailable and rejects execution without a loaded AgentLoop', async () => {
    const host = await loadPetHost([locus('a', CHILD_A)])
    try {
      const main = await host.agentScope(MAIN)
      host.publish(MAIN, main.scope)
      await waitForWiring()
      expect(await ownerInquiry(host)).toBe('unavailable')
      const child = await host.agentScope(CHILD_A)
      host.publish(CHILD_A, child.scope)
      expect(host.toolNames(child.key)).toContain('pet_inquire')
      const before = inquiryRows(host).length
      const result = await executeInquiry(host, Object.assign(child.key, { ctx: child.scope }))
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('Inquiry runtime unavailable')
      expect(inquiryRows(host)).toHaveLength(before)
      console.info('baseline pet_inquire error:', JSON.stringify(result))
    } finally { await host.close() }
  })

  it('installs AgentLoop before Pet and reports readiness after child and main publication', async () => {
    const host = await loadPetHost([locus('a', CHILD_A)], undefined, undefined, installLoop)
    try {
      const child = await host.agentScope(CHILD_A)
      const main = await host.agentScope(MAIN)
      host.publish(CHILD_A, child.scope)
      host.publish(MAIN, main.scope)
      await waitForWiring()
      expect(host.toolNames(child.key)).toContain('pet_inquire')
      expect(host.toolNames(main.key)).toContain('pet_inquire')
      expect(await ownerInquiry(host)).toBe('available')
    } finally { await host.close() }
  })

  it('keeps repeated agent/created handling idempotent for a main agent', async () => {
    const host = await loadPetHost([locus('a', CHILD_A)], undefined, undefined, installLoop)
    try {
      const child = await host.agentScope(CHILD_A)
      const main = await host.agentScope(MAIN)
      host.publish(MAIN, main.scope)
      host.publish(MAIN, main.scope)
      host.publish(MAIN, main.scope)
      await waitForWiring()
      expect(host.toolNames(main.key).filter(name => name === 'pet_inquire')).toHaveLength(1)
      expect(host.toolNames(main.key).filter(name => name === 'pet_inquiry_answer')).toHaveLength(1)
      expect(await ownerInquiry(host)).toBe('available')
    } finally { await host.close() }
  })

  it('does not expose pet_inquire on an unpublished circle agent scope', async () => {
    const host = await loadPetHost([locus('a', CHILD_A)], undefined, undefined, installLoop)
    try {
      const bypass = await host.agentScope('bypass-agent')
      expect(host.toolNames(bypass.key)).not.toContain('pet_inquire')
    } finally { await host.close() }
  })
})
