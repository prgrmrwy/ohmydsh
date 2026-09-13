/**
 * Pet-side deterministic effect fence for an inquiry turn (G4 partial).
 *
 * `test/inquiry-runtime-probe.test.ts` records the observed CURRENT GAP that
 * the reviewed runtime's scoped monotonic guard runs at PREPARATION only: a
 * revocation that lands while an async `tools/execute` wrapper is suspended
 * does not stop the tool body. These tests pin a Pet-owned fence that does not
 * depend on that runtime behaviour: the fence re-validates with no suspension
 * point between its final check and the body.
 *
 * This is a pure unit: no Cordis, no DSH runtime, no I/O, no timers, no real
 * tool body. Passing these tests does NOT by itself satisfy G4 — see the
 * module header for the seam that is still required on the runtime side.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createInquiryEffectFence,
  InquiryEffectError,
  INQUIRY_FORBIDDEN_TOOLS,
  type InquiryEffectFenceTool,
} from '../src/host/inquiry/effect-fence.js'

const tool = (name: string) => ({ name })

describe('inquiry turn effect fence', () => {
  it('allows only tools proven safe for an inquiry turn', () => {
    const fence = createInquiryEffectFence({ allow: ['pet_collaboration_context', 'pet_answer'] })
    expect(fence.decide(tool('pet_collaboration_context'))).toEqual({ allowed: true })
    expect(fence.decide(tool('pet_answer'))).toEqual({ allowed: true })
  })

  it.each([
    // effectful / local write
    'write', 'edit', 'apply_patch', 'multi_edit', 'bash', 'shell',
    // outbound / network
    'web_fetch', 'web_search', 'x_search', 'image_generate', 'video_generate',
    // delegation and cross-agent control
    'subagent', 'subagent_fork', 'task', 'send_message', 'interrupt_agent', 'workflow', 'ralph',
    // Pet surfaces that carry the target's own authority
    'pet_locus_reply', 'pet_collaboration_context_update',
  ])(
    'refuses effectful or delegating tool %s even when the target itself may use it',
    name => {
      const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
      expect(fence.decide(tool(name))).toMatchObject({ allowed: false })
    },
  )

  it('refuses an unknown tool rather than assuming it is a safe read', () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    expect(fence.decide(tool('some_new_plugin_tool'))).toMatchObject({ allowed: false })
  })

  it.each(['bash', 'subagent', 'pet_locus_reply', 'write'])(
    'keeps refusing forbidden tool %s even when a caller misconfigures it into the allowlist',
    async name => {
      const fence = createInquiryEffectFence({ allow: ['pet_answer', name] })
      expect(fence.decide(tool(name))).toMatchObject({ allowed: false })
      const body = vi.fn()
      await expect(fence.run(tool(name), body)).rejects.toBeInstanceOf(InquiryEffectError)
      expect(body).not.toHaveBeenCalled()
    },
  )

  it('exposes the always-forbidden set as a stable, non-empty constant', () => {
    expect(INQUIRY_FORBIDDEN_TOOLS).toContain('bash')
    expect(INQUIRY_FORBIDDEN_TOOLS).toContain('pet_locus_reply')
    expect(INQUIRY_FORBIDDEN_TOOLS).toContain('subagent')
  })

  it.each(['Bash', ' pet_answer', 'pet_answer ', 'pet answer', 'pet_answer\n', '', 'pet-answer', '_pet'])(
    'refuses a name that is not an exact normalized tool identifier: %j',
    name => {
      const fence = createInquiryEffectFence({ allow: ['pet_answer', name] })
      expect(fence.decide(tool(name))).toMatchObject({ allowed: false })
    },
  )

  it('refuses a structurally invalid tool reference instead of throwing', () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    const invalid = [undefined, null, {}, { name: 42 }, { name: null }]
    for (const value of invalid) {
      expect(fence.decide(value as unknown as InquiryEffectFenceTool)).toMatchObject({ allowed: false })
    }
  })

  it('runs the body and returns its value while the inquiry turn stays active', async () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    await expect(fence.run(tool('pet_answer'), async () => 'answered')).resolves.toBe('answered')
  })

  it('propagates a body failure unchanged rather than disguising it as a refusal', async () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    const failure = new Error('body failed')
    await expect(fence.run(tool('pet_answer'), async () => { throw failure })).rejects.toBe(failure)
  })

  it('never enters the body of a refused tool', async () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    const body = vi.fn()
    await expect(fence.run(tool('bash'), body)).rejects.toBeInstanceOf(InquiryEffectError)
    expect(body).not.toHaveBeenCalled()
  })

  it('re-decides at the effect boundary, so revocation between preparation and body is caught', async () => {
    let live = true
    const fence = createInquiryEffectFence({ allow: ['pet_answer'], isActive: () => live })
    const release = Promise.withResolvers<void>()
    const body = vi.fn(async () => 'effect happened')
    const running = fence.run(tool('pet_answer'), async () => {
      await release.promise
      return body()
    })
    live = false
    release.resolve()
    await expect(running).rejects.toBeInstanceOf(InquiryEffectError)
    expect(body).not.toHaveBeenCalled()
  })

  it('validates after the async wrapper window, leaving no suspension point before the body', async () => {
    let live = true
    const order: string[] = []
    const fence = createInquiryEffectFence({
      allow: ['pet_answer'],
      isActive: () => { order.push('check'); return live },
      // Stands in for the runtime's suspended `tools/execute` wrapper.
      settle: async () => { order.push('wrapper-window'); live = false },
    })
    const body = vi.fn()
    await expect(fence.run(tool('pet_answer'), body)).rejects.toBeInstanceOf(InquiryEffectError)
    expect(body).not.toHaveBeenCalled()
    expect(order).toEqual(['check', 'wrapper-window', 'check'])
  })

  it('fails closed when the liveness seam itself throws', async () => {
    const fence = createInquiryEffectFence({
      allow: ['pet_answer'],
      isActive: () => { throw new Error('identity lookup exploded') },
    })
    expect(fence.decide(tool('pet_answer'))).toMatchObject({ allowed: false, reason: 'inquiry-turn-revoked' })
    const body = vi.fn()
    await expect(fence.run(tool('pet_answer'), body)).rejects.toBeInstanceOf(InquiryEffectError)
    expect(body).not.toHaveBeenCalled()
  })

  it('keeps refusing every later call once the inquiry turn is closed', async () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    expect(fence.decide(tool('pet_answer'))).toEqual({ allowed: true })
    fence.close()
    expect(fence.decide(tool('pet_answer'))).toMatchObject({ allowed: false })
    await expect(fence.run(tool('pet_answer'), async () => 'x')).rejects.toBeInstanceOf(InquiryEffectError)
  })

  it('treats close as idempotent and irreversible', () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    fence.close()
    fence.close()
    expect(fence.decide(tool('pet_answer'))).toEqual({ allowed: false, reason: 'inquiry-turn-closed' })
  })

  it('holds through concurrent calls: closing mid-flight stops the ones not yet in their body', async () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    const release = Promise.withResolvers<void>()
    const ran: string[] = []
    const calls = ['a', 'b', 'c'].map(id => fence.run(tool('pet_answer'), async () => {
      await release.promise
      ran.push(id)
      return id
    }).catch((error: Error) => error))
    fence.close()
    release.resolve()
    const results = await Promise.all(calls)
    expect(ran).toEqual([])
    expect(results.every(value => value instanceof InquiryEffectError)).toBe(true)
  })

  it('stops a mixed concurrent batch, including calls suspended inside the wrapper window', async () => {
    const gate = Promise.withResolvers<void>()
    const fence = createInquiryEffectFence({
      allow: ['pet_answer', 'pet_collaboration_context'],
      settle: () => gate.promise,
    })
    const ran: string[] = []
    const names = ['pet_answer', 'pet_collaboration_context', 'pet_answer', 'pet_collaboration_context']
    const calls = names.map((name, index) => fence
      .run(tool(name), async () => { ran.push(`${name}#${index}`); return index })
      .catch((error: Error) => error))
    fence.close()
    gate.resolve()
    const results = await Promise.all(calls)
    expect(ran).toEqual([])
    expect(results.map(value => (value as InquiryEffectError).reason))
      .toEqual(['inquiry-turn-closed', 'inquiry-turn-closed', 'inquiry-turn-closed', 'inquiry-turn-closed'])
  })

  it('does not let a passing decide() authorize a later run(): the decision is not a token', async () => {
    let live = true
    const fence = createInquiryEffectFence({ allow: ['pet_answer'], isActive: () => live })
    expect(fence.decide(tool('pet_answer'))).toEqual({ allowed: true })
    live = false
    const body = vi.fn()
    await expect(fence.run(tool('pet_answer'), body)).rejects.toMatchObject({ reason: 'inquiry-turn-revoked' })
    expect(body).not.toHaveBeenCalled()
  })

  it('does not let a passing decide() for one tool authorize running another', async () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    expect(fence.decide(tool('pet_answer'))).toEqual({ allowed: true })
    const body = vi.fn()
    await expect(fence.run(tool('bash'), body)).rejects.toMatchObject({
      reason: 'effect-not-permitted-in-inquiry-turn',
    })
    expect(body).not.toHaveBeenCalled()
  })

  it('LIMIT: cannot unwind a body already running when close() lands', async () => {
    // Honest boundary, asserted so nobody later reads the fence as a sandbox.
    // Once the final check has passed there is no suspension point left to
    // interpose, so a revocation arriving after it cannot stop this call.
    // Cancelling in-flight effects needs a runtime seam (abort propagation),
    // which this pure module deliberately does not fake.
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let completed = false
    const running = fence.run(tool('pet_answer'), async () => {
      entered.resolve()
      await release.promise
      completed = true
      return 'done'
    })
    await entered.promise
    fence.close()
    release.resolve()
    await expect(running).resolves.toBe('done')
    expect(completed).toBe(true)
    // The turn is still closed for everything that had not yet reached a body.
    await expect(fence.run(tool('pet_answer'), async () => 'x')).rejects.toMatchObject({
      reason: 'inquiry-turn-closed',
    })
  })

  it('reports a stable reason without echoing tool arguments or internal state', () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    const decision = fence.decide(tool('bash'))
    expect(decision).toEqual({ allowed: false, reason: 'effect-not-permitted-in-inquiry-turn' })
  })

  it('raises a refusal that carries only the stable reason and the requested name', async () => {
    const fence = createInquiryEffectFence({ allow: ['pet_answer'] })
    const error = await fence
      .run(tool('bash'), async () => 'never')
      .catch((value: unknown) => value as InquiryEffectError)
    expect(error).toBeInstanceOf(InquiryEffectError)
    expect(error.name).toBe('InquiryEffectError')
    expect(error.message).toBe('effect-not-permitted-in-inquiry-turn')
    expect(error.reason).toBe('effect-not-permitted-in-inquiry-turn')
    expect(error.toolName).toBe('bash')
    // Nothing else is carried: no allowlist, no session/locus identity, no paths.
    expect(Object.keys(error).sort()).toEqual(['reason', 'toolName'])
  })

  it('does not leak which tools are allowed through the refusal of a forbidden one', () => {
    const wide = createInquiryEffectFence({ allow: ['pet_answer', 'pet_collaborators', 'pet_collaboration_context'] })
    const narrow = createInquiryEffectFence({ allow: ['pet_answer'] })
    expect(wide.decide(tool('bash'))).toEqual(narrow.decide(tool('bash')))
    expect(wide.decide(tool('some_new_plugin_tool'))).toEqual(narrow.decide(tool('some_new_plugin_tool')))
  })

  it('does not observe the allowlist argument after construction', () => {
    const allow = ['pet_answer']
    const fence = createInquiryEffectFence({ allow })
    allow.push('bash')
    expect(fence.decide(tool('bash'))).toMatchObject({ allowed: false })
  })
})
