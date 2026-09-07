/**
 * Probing the host for QA support.
 *
 * The probe exists because Pet MUST keep loading on a Host without the
 * subagent seam: a declared dependency would take the whole plugin down,
 * which is the exact failure the lifecycle contract forbids. So every missing
 * piece has to produce a NAMED reason rather than an exception — the wheel
 * shows that reason instead of silently dropping the action.
 */

import { describe, expect, it, vi } from 'vitest'
import { probeSubagentSeam, resolveLiveParent } from '../src/host/qa/subagents.js'
import type { HostContextLike, LiveAgentLike, SubagentSeam } from '../src/host/qa/subagents.js'

/** The symbol the host keys its queue entry point by. */
const QUEUE = Symbol.for('dsh.subagent.queuePrompt')

/** A context whose services each test can remove. */
function hostContext(
  options: {
    agents?: unknown
    subagents?: unknown
    on?: unknown
  } = {},
): HostContextLike {
  const services: Record<string, unknown> = {
    agents: 'agents' in options ? options.agents : { get: () => undefined, resume: async () => ({}) },
    subagents:
      'subagents' in options
        ? options.subagents
        : {
            startContinuable: async () => ({ childId: 'c' }),
            drainContinuableChildren: async () => undefined,
            listChildren: async () => [],
            [QUEUE]: async () => 'message-1',
          },
  }
  const ctx: HostContextLike = {
    get: name => services[name],
    ...('on' in options
      ? (options.on === undefined ? {} : { on: options.on as HostContextLike['on'] })
      : { on: () => () => undefined }),
  }
  return ctx
}

describe('probing the subagent seam', () => {
  it('binds every capability when the host has them', () => {
    const probe = probeSubagentSeam(hostContext())

    expect(probe.available).toBe(true)
  })

  it('reports a host without the agents service', () => {
    const probe = probeSubagentSeam(hostContext({ agents: undefined }))

    expect(probe.available).toBe(false)
    if (!probe.available) expect(probe.diagnostic).toContain('agents')
  })

  it('reports a host without the subagents service', () => {
    const probe = probeSubagentSeam(hostContext({ subagents: undefined }))

    expect(probe.available).toBe(false)
    if (!probe.available) expect(probe.diagnostic).toContain('subagents')
  })

  it('reports a subagents service that cannot take host messages', () => {
    // Present but without the symbol-keyed host entry point — an older or
    // partial runtime. Detected explicitly rather than crashing at the first
    // question, which would be hours after the group was created.
    const probe = probeSubagentSeam(
      hostContext({
        subagents: {
          startContinuable: async () => ({ childId: 'c' }),
          drainContinuableChildren: async () => undefined,
          listChildren: async () => [],
        },
      }),
    )

    expect(probe.available).toBe(false)
    if (!probe.available) expect(probe.diagnostic).toContain('queuePrompt')
  })

  it('reports a host with no event subscription', () => {
    const probe = probeSubagentSeam(hostContext({ on: undefined }))

    expect(probe.available).toBe(false)
    // Without settlement events nothing could ever clear a working reaction.
    if (!probe.available) expect(probe.diagnostic).toContain('事件')
  })

  it('passes host-authored text through the symbol entry point', async () => {
    const calls: unknown[][] = []
    const probe = probeSubagentSeam(
      hostContext({
        subagents: {
          startContinuable: async () => ({ childId: 'c' }),
          drainContinuableChildren: async () => undefined,
          listChildren: async () => [],
          [QUEUE]: async (...args: unknown[]) => {
            calls.push(args)
            return 'message-7'
          },
        },
      }),
    )
    expect(probe.available).toBe(true)
    if (!probe.available) return

    const parent = { session: { id: 'p' } }
    const id = await probe.seam.queuePrompt(parent, 'child', '问题', AbortSignal.timeout(1000))

    expect(id).toBe('message-7')
    // Content blocks and a durable message source, exactly as the spike
    // measured the real entry point to expect.
    expect(calls[0]?.[2]).toEqual([{ type: 'text', text: '问题' }])
    expect(calls[0]?.[3]).toEqual({ kind: 'user' })
  })

  it('forwards only well-formed settlement events', () => {
    let emit: ((...args: unknown[]) => void) | undefined
    const probe = probeSubagentSeam(
      hostContext({
        on: (_event: string, listener: (...args: unknown[]) => void) => {
          emit = listener
          return () => undefined
        },
      }),
    )
    expect(probe.available).toBe(true)
    if (!probe.available) return
    const seen: { id: string; stopReason?: string }[] = []
    probe.seam.onChildSettled(info => seen.push(info))

    emit?.({ id: 'child-1', stopReason: 'completed' })
    emit?.(undefined)
    emit?.({ stopReason: 'completed' })

    // A payload with no child id names nothing to settle; acting on it would
    // mark an unrelated message.
    expect(seen).toEqual([{ id: 'child-1', stopReason: 'completed' }])
  })
})

describe('resolving a live parent', () => {
  /** A seam whose agent registry each test can bend. */
  function seamWith(agents: SubagentSeam['agents']): SubagentSeam {
    return {
      agents,
      subagents: {
        startContinuable: async () => ({ childId: 'c' }),
        drainContinuableChildren: async () => undefined,
        listChildren: async () => [],
      },
      queuePrompt: async () => 'm',
      onChildSettled: () => () => undefined,
    }
  }

  it('uses the resident agent without resuming', async () => {
    const resume = vi.fn()
    const seam = seamWith({
      get: (id: string) => ({ session: { id } }) as LiveAgentLike,
      resume: resume as never,
    })

    const parent = await resolveLiveParent(seam, 'session-source')

    expect(parent?.session.id).toBe('session-source')
    expect(resume).not.toHaveBeenCalled()
  })

  it('resumes when the session is not resident', async () => {
    const seam = seamWith({
      get: () => undefined,
      resume: async ({ resumeSessionId }) => ({
        agent: { session: { id: resumeSessionId } } as LiveAgentLike,
      }),
    })

    const parent = await resolveLiveParent(seam, 'session-source')

    expect(parent?.session.id).toBe('session-source')
  })

  it('reports an unresumable session as absent rather than throwing', async () => {
    const seam = seamWith({
      get: () => undefined,
      resume: async () => {
        throw new Error('cannot resume: session persistence is not configured')
      },
    })

    // Archived, deleted and persistence-less are indistinguishable here and
    // equally terminal, so the caller invalidates instead of retrying.
    await expect(resolveLiveParent(seam, 'gone')).resolves.toBeUndefined()
  })
})
