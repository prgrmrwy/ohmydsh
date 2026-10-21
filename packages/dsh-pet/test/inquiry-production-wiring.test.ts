import { describe, expect, it } from 'vitest'
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
  it('keeps inquiry dispatch unavailable and rejects execution without a loaded AgentLoop', async () => {
    const host = await loadPetHost([locus('a', CHILD_A)])
    try {
      const main = await host.agentScope(MAIN)
      host.publish(MAIN, main.scope)
      await waitForWiring()
      expect(await ownerInquiry(host)).toBe('unavailable')
      const child = await host.agentScope(CHILD_A)
      const before = inquiryRows(host).length
      const result = await executeInquiry(host, { id: CHILD_A })
      expect(result.isError).toBe(true)
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
