/**
 * Pet-side deterministic effect fence for an inquiry turn (G4 partial).
 *
 * The fence enforces two independent rules:
 *   1. No new authority — the turn runs with the target's own inherited tool
 *      snapshot, and a name absent from it is refused (so unknown tools are
 *      never assumed safe). The target keeps its NORMAL permissions: an
 *      inquiry neither widens nor narrows them, and using them is not treated
 *      as delegating them to the requester.
 *   2. No identity/communication authority transfer — a narrow hard floor is
 *      refused even when the target legitimately holds the tool.
 *
 * `test/inquiry-runtime-probe.test.ts` records the observed CURRENT GAP that
 * the reviewed runtime's scoped monotonic guard runs at PREPARATION only: a
 * revocation landing while an async `tools/execute` wrapper is suspended does
 * not stop the tool body. These tests pin a fence that does not depend on that
 * runtime behaviour: it re-validates with no suspension point before the body.
 *
 * Pure unit: no Cordis, no DSH runtime, no I/O, no timers, no real tool body.
 * Passing these tests does NOT by itself satisfy G4 — see the module header.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createInquiryEffectFence,
  InquiryEffectError,
  INQUIRY_FORBIDDEN_TOOLS,
  type InquiryEffectFenceTool,
} from '../src/host/inquiry/effect-fence.js'

const tool = (name: string) => ({ name })

/** A plausible normal snapshot for a write-capable target. */
const WRITE_TARGET_SNAPSHOT = [
  'read', 'glob', 'grep', 'write', 'edit', 'apply_patch', 'bash', 'shell',
  'web_fetch', 'web_search',
  'pet_context', 'pet_collaborators', 'pet_collaboration_context',
  'pet_collaboration_context_update', 'pet_inquiry_answer',
]

/** A plausible normal snapshot for a read-only target. */
const READ_TARGET_SNAPSHOT = [
  'read', 'glob', 'grep',
  'pet_context', 'pet_collaborators', 'pet_collaboration_context', 'pet_inquiry_answer',
]

describe('inquiry turn effect fence', () => {
  describe('rule 1: an inquiry grants no new authority', () => {
    it('allows the tools the target normally holds, including ordinary read tools', () => {
      const fence = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      for (const name of ['read', 'glob', 'grep', 'pet_collaboration_context', 'pet_inquiry_answer']) {
        expect(fence.decide(tool(name))).toEqual({ allowed: true })
      }
    })

    it('does not narrow a write-capable target into a read-only one', async () => {
      // The inquiry path must neither widen nor narrow the target's ceiling,
      // and the target using its OWN normal permissions is not a transfer of
      // those permissions to the requester. These effectful names were
      // hard-refused by the earlier design; they are now governed by rule 1.
      const fence = createInquiryEffectFence({ inherited: WRITE_TARGET_SNAPSHOT })
      for (const name of ['write', 'edit', 'apply_patch', 'bash', 'shell', 'web_fetch', 'web_search']) {
        expect(fence.decide(tool(name))).toEqual({ allowed: true })
      }
      await expect(fence.run(tool('write'), async () => 'wrote')).resolves.toBe('wrote')
      await expect(fence.run(tool('bash'), async () => 'ran')).resolves.toBe('ran')
      await expect(fence.run(tool('web_fetch'), async () => 'fetched')).resolves.toBe('fetched')
    })

    it('refuses the same effectful names when the target does not hold them', () => {
      const fence = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      for (const name of ['write', 'edit', 'apply_patch', 'bash', 'shell', 'web_fetch']) {
        expect(fence.decide(tool(name))).toEqual({
          allowed: false,
          reason: 'tool-outside-inherited-authority',
        })
      }
    })

    it('refuses an unknown tool absent from the snapshot rather than assuming it is safe', async () => {
      const fence = createInquiryEffectFence({ inherited: WRITE_TARGET_SNAPSHOT })
      const body = vi.fn()
      expect(fence.decide(tool('some_new_plugin_tool'))).toEqual({
        allowed: false,
        reason: 'tool-outside-inherited-authority',
      })
      await expect(fence.run(tool('some_new_plugin_tool'), body)).rejects.toBeInstanceOf(InquiryEffectError)
      expect(body).not.toHaveBeenCalled()
    })

    it('refuses everything when the snapshot is empty', () => {
      const fence = createInquiryEffectFence({ inherited: [] })
      expect(fence.decide(tool('read'))).toMatchObject({ allowed: false })
      expect(fence.decide(tool('pet_inquiry_answer'))).toMatchObject({ allowed: false })
    })

    it('lets the public context update pass when the target normally holds it', async () => {
      // Explicitly NOT hard-forbidden: its own caller-bound membership check
      // and revision CAS still apply, and they do not weaken during an inquiry.
      const fence = createInquiryEffectFence({ inherited: WRITE_TARGET_SNAPSHOT })
      expect(fence.decide(tool('pet_collaboration_context_update'))).toEqual({ allowed: true })
      await expect(
        fence.run(tool('pet_collaboration_context_update'), async () => 'revision-2'),
      ).resolves.toBe('revision-2')
    })

    it('still refuses the public context update for a target that does not hold it', () => {
      const fence = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      expect(fence.decide(tool('pet_collaboration_context_update'))).toEqual({
        allowed: false,
        reason: 'tool-outside-inherited-authority',
      })
    })
  })

  describe('rule 2: an inquiry may not transfer identity or communication authority', () => {
    it.each([
      'pet_locus_reply',
      'send_message',
      'interrupt_agent',
      'subagent',
      'subagent_fork',
      'task',
      'workflow',
      'ralph',
      'agent',
    ])('refuses %s even when the target itself normally holds it', async name => {
      // The snapshot deliberately CONTAINS the floor name: inheriting it is
      // exactly the case the floor exists for.
      const fence = createInquiryEffectFence({ inherited: [...WRITE_TARGET_SNAPSHOT, name] })
      expect(fence.decide(tool(name))).toEqual({
        allowed: false,
        reason: 'authority-transfer-not-permitted-in-inquiry-turn',
      })
      const body = vi.fn()
      await expect(fence.run(tool(name), body)).rejects.toBeInstanceOf(InquiryEffectError)
      expect(body).not.toHaveBeenCalled()
    })

    it('never lets an inquiry consume the target own Feishu delivery', () => {
      const fence = createInquiryEffectFence({ inherited: ['pet_locus_reply', 'pet_inquiry_answer'] })
      expect(fence.decide(tool('pet_locus_reply'))).toMatchObject({
        allowed: false,
        reason: 'authority-transfer-not-permitted-in-inquiry-turn',
      })
      // The sanctioned answer path stays available.
      expect(fence.decide(tool('pet_inquiry_answer'))).toEqual({ allowed: true })
    })

    it('exposes the floor as a stable constant limited to transfer surfaces', () => {
      expect(INQUIRY_FORBIDDEN_TOOLS).toContain('pet_locus_reply')
      expect(INQUIRY_FORBIDDEN_TOOLS).toContain('send_message')
      expect(INQUIRY_FORBIDDEN_TOOLS).toContain('subagent')
      // Ordinary effectful work is rule 1's business, not the floor's.
      expect(INQUIRY_FORBIDDEN_TOOLS).not.toContain('bash')
      expect(INQUIRY_FORBIDDEN_TOOLS).not.toContain('shell')
      expect(INQUIRY_FORBIDDEN_TOOLS).not.toContain('write')
      expect(INQUIRY_FORBIDDEN_TOOLS).not.toContain('web_fetch')
      // The shared public record is explicitly governed by its own CAS.
      expect(INQUIRY_FORBIDDEN_TOOLS).not.toContain('pet_collaboration_context_update')
    })

    it('extends the floor through alsoForbid, for surfaces this module cannot predict', async () => {
      // Pet exposes no model-facing permission/scope/binding mutation tool
      // today; when one is added, the dispatcher names it here.
      const fence = createInquiryEffectFence({
        inherited: [...WRITE_TARGET_SNAPSHOT, 'pet_locus_rebind', 'pet_permission_set'],
        alsoForbid: ['pet_locus_rebind', 'pet_permission_set'],
      })
      for (const name of ['pet_locus_rebind', 'pet_permission_set']) {
        expect(fence.decide(tool(name))).toEqual({
          allowed: false,
          reason: 'authority-transfer-not-permitted-in-inquiry-turn',
        })
        const body = vi.fn()
        await expect(fence.run(tool(name), body)).rejects.toBeInstanceOf(InquiryEffectError)
        expect(body).not.toHaveBeenCalled()
      }
      // Unrelated inherited work is unaffected by the extension.
      expect(fence.decide(tool('write'))).toEqual({ allowed: true })
    })

    it('checks the floor before the snapshot so a snapshot cannot override it', () => {
      const fence = createInquiryEffectFence({ inherited: ['send_message'] })
      expect(fence.decide(tool('send_message'))).toEqual({
        allowed: false,
        reason: 'authority-transfer-not-permitted-in-inquiry-turn',
      })
    })
  })

  describe('name handling', () => {
    it.each(['Bash', ' read', 'read ', 'pet answer', 'read\n', '', 'pet-answer', '_pet'])(
      'refuses a name that is not an exact normalized tool identifier: %j',
      name => {
        const fence = createInquiryEffectFence({ inherited: [...READ_TARGET_SNAPSHOT, name] })
        expect(fence.decide(tool(name))).toMatchObject({ allowed: false })
      },
    )

    it('does not normalize a lookalike into a floor bypass', () => {
      const fence = createInquiryEffectFence({ inherited: ['send_message ', 'Send_Message'] })
      expect(fence.decide(tool('send_message '))).toEqual({
        allowed: false,
        reason: 'tool-reference-unusable',
      })
      expect(fence.decide(tool('Send_Message'))).toEqual({
        allowed: false,
        reason: 'tool-reference-unusable',
      })
    })

    it('refuses a structurally invalid tool reference instead of throwing', () => {
      const fence = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      for (const value of [undefined, null, {}, { name: 42 }, { name: null }]) {
        expect(fence.decide(value as unknown as InquiryEffectFenceTool))
          .toEqual({ allowed: false, reason: 'tool-reference-unusable' })
      }
    })

    it('does not observe the snapshot argument after construction', () => {
      const inherited = ['read']
      const fence = createInquiryEffectFence({ inherited })
      inherited.push('write')
      expect(fence.decide(tool('write'))).toMatchObject({ allowed: false })
    })

    it('does not observe the alsoForbid argument after construction', () => {
      const alsoForbid: string[] = []
      const fence = createInquiryEffectFence({ inherited: ['write'], alsoForbid })
      alsoForbid.push('write')
      expect(fence.decide(tool('write'))).toEqual({ allowed: true })
    })
  })

  describe('effect boundary', () => {
    it('runs the body and returns its value while the inquiry turn stays active', async () => {
      const fence = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      await expect(fence.run(tool('read'), async () => 'contents')).resolves.toBe('contents')
    })

    it('propagates a body failure unchanged rather than disguising it as a refusal', async () => {
      const fence = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      const failure = new Error('body failed')
      await expect(fence.run(tool('read'), async () => { throw failure })).rejects.toBe(failure)
    })

    it('never enters the body of a refused tool', async () => {
      const fence = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      const body = vi.fn()
      await expect(fence.run(tool('bash'), body)).rejects.toBeInstanceOf(InquiryEffectError)
      expect(body).not.toHaveBeenCalled()
    })

    it('re-decides at the effect boundary, so revocation between preparation and body is caught', async () => {
      let live = true
      const fence = createInquiryEffectFence({ inherited: ['read'], isActive: () => live })
      const release = Promise.withResolvers<void>()
      const body = vi.fn(async () => 'effect happened')
      const running = fence.run(tool('read'), async () => {
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
        inherited: ['read'],
        isActive: () => { order.push('check'); return live },
        // Stands in for the runtime's suspended `tools/execute` wrapper.
        settle: async () => { order.push('wrapper-window'); live = false },
      })
      const body = vi.fn()
      await expect(fence.run(tool('read'), body)).rejects.toMatchObject({ reason: 'inquiry-turn-revoked' })
      expect(body).not.toHaveBeenCalled()
      expect(order).toEqual(['check', 'wrapper-window', 'check'])
    })

    it('fails closed when the liveness seam itself throws', async () => {
      const fence = createInquiryEffectFence({
        inherited: ['read'],
        isActive: () => { throw new Error('identity lookup exploded') },
      })
      expect(fence.decide(tool('read'))).toMatchObject({ allowed: false, reason: 'inquiry-turn-revoked' })
      const body = vi.fn()
      await expect(fence.run(tool('read'), body)).rejects.toBeInstanceOf(InquiryEffectError)
      expect(body).not.toHaveBeenCalled()
    })

    it('does not let a passing decide() authorize a later run(): the decision is not a token', async () => {
      let live = true
      const fence = createInquiryEffectFence({ inherited: ['write'], isActive: () => live })
      expect(fence.decide(tool('write'))).toEqual({ allowed: true })
      live = false
      const body = vi.fn()
      await expect(fence.run(tool('write'), body)).rejects.toMatchObject({ reason: 'inquiry-turn-revoked' })
      expect(body).not.toHaveBeenCalled()
    })

    it('does not let a passing decide() for one tool authorize running another', async () => {
      const fence = createInquiryEffectFence({ inherited: ['read', 'send_message'] })
      expect(fence.decide(tool('read'))).toEqual({ allowed: true })
      const body = vi.fn()
      await expect(fence.run(tool('send_message'), body)).rejects.toMatchObject({
        reason: 'authority-transfer-not-permitted-in-inquiry-turn',
      })
      expect(body).not.toHaveBeenCalled()
    })
  })

  describe('turn lifetime', () => {
    it('keeps refusing every later call once the inquiry turn is closed', async () => {
      const fence = createInquiryEffectFence({ inherited: ['read'] })
      expect(fence.decide(tool('read'))).toEqual({ allowed: true })
      fence.close()
      expect(fence.decide(tool('read'))).toMatchObject({ allowed: false })
      await expect(fence.run(tool('read'), async () => 'x')).rejects.toBeInstanceOf(InquiryEffectError)
    })

    it('treats close as idempotent and irreversible', () => {
      const fence = createInquiryEffectFence({ inherited: ['read'] })
      fence.close()
      fence.close()
      expect(fence.decide(tool('read'))).toEqual({ allowed: false, reason: 'inquiry-turn-closed' })
    })

    it('holds through concurrent calls: closing mid-flight stops the ones not yet in their body', async () => {
      const fence = createInquiryEffectFence({ inherited: ['read'] })
      const release = Promise.withResolvers<void>()
      const ran: string[] = []
      const calls = ['a', 'b', 'c'].map(id => fence.run(tool('read'), async () => {
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
        inherited: ['read', 'write'],
        settle: () => gate.promise,
      })
      const ran: string[] = []
      const names = ['read', 'write', 'read', 'write']
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

    it('LIMIT: cannot unwind a body already running when close() lands', async () => {
      // Honest boundary, asserted so nobody later reads the fence as a sandbox.
      // Once the final check has passed there is no suspension point left to
      // interpose, so a revocation arriving after it cannot stop this call.
      // Cancelling in-flight effects needs a runtime seam (abort propagation).
      const fence = createInquiryEffectFence({ inherited: ['write'] })
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let completed = false
      const running = fence.run(tool('write'), async () => {
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
      await expect(fence.run(tool('write'), async () => 'x')).rejects.toMatchObject({
        reason: 'inquiry-turn-closed',
      })
    })
  })

  describe('refusal disclosure', () => {
    it('reports a stable reason without echoing tool arguments or internal state', () => {
      const fence = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      expect(fence.decide(tool('bash'))).toEqual({
        allowed: false,
        reason: 'tool-outside-inherited-authority',
      })
    })

    it('raises a refusal that carries only the stable reason and the requested name', async () => {
      const fence = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      const error = await fence
        .run(tool('send_message'), async () => 'never')
        .catch((value: unknown) => value as InquiryEffectError)
      expect(error).toBeInstanceOf(InquiryEffectError)
      expect(error.name).toBe('InquiryEffectError')
      expect(error.message).toBe('authority-transfer-not-permitted-in-inquiry-turn')
      expect(error.reason).toBe('authority-transfer-not-permitted-in-inquiry-turn')
      expect(error.toolName).toBe('send_message')
      // Nothing else is carried: no snapshot, no session/locus identity, no paths.
      expect(Object.keys(error).sort()).toEqual(['reason', 'toolName'])
    })

    it('does not reveal the snapshot contents through the refusal of a floor name', () => {
      const wide = createInquiryEffectFence({ inherited: WRITE_TARGET_SNAPSHOT })
      const narrow = createInquiryEffectFence({ inherited: READ_TARGET_SNAPSHOT })
      expect(wide.decide(tool('send_message'))).toEqual(narrow.decide(tool('send_message')))
    })

    it('refuses identically for every tool once revoked, so refusals cannot probe the snapshot', () => {
      const fence = createInquiryEffectFence({ inherited: WRITE_TARGET_SNAPSHOT, isActive: () => false })
      for (const name of ['read', 'write', 'send_message', 'some_new_plugin_tool']) {
        expect(fence.decide(tool(name))).toEqual({ allowed: false, reason: 'inquiry-turn-revoked' })
      }
    })
  })
})
