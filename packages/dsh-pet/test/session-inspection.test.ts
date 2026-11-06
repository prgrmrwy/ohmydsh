import { describe, expect, it, vi } from 'vitest'
import { createSessionInspector } from '../src/host/session-inspection.js'

/**
 * DSH 0.2.2 removed `sessionController.inspect`. 0.2.1's implementation was
 * `sessionQuery.observeSession(id, { signal, projectionMode: 'none' })`, "not found"
 * when the header has no `cwd`, returning `{ meta, inheritedEventCount, events }`
 * and releasing the lease. These tests pin that contract on the replacement.
 */
function lease(header: Record<string, unknown>, events: unknown[] = [], inheritedEventCount = 0) {
  const dispose = vi.fn()
  return { header, events, inheritedEventCount, [Symbol.dispose]: dispose, dispose }
}

describe('createSessionInspector over sessionQuery.observeSession', () => {
  it('returns the 0.2.1 inspection shape, asks for no projections, forwards the signal, and releases the lease', async () => {
    const header = { id: 'session-a', cwd: '/work', agentPreset: 'standard' }
    const events = [{ type: 'a' }, { type: 'b' }]
    const observation = lease(header, events, 3)
    const observeSession = vi.fn(async () => observation)
    const inspect = createSessionInspector({ observeSession } as never)!
    const signal = new AbortController().signal

    const result = await inspect('session-a', signal)

    expect(observeSession).toHaveBeenCalledWith('session-a', { signal, projectionMode: 'none' })
    expect(result.meta).toBe(header)
    expect(result.inheritedEventCount).toBe(3)
    expect(result.events).toEqual(events)
    expect(result.events).not.toBe(events) // a copy, as 0.2.1 returned
    expect(observation.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the receiver of observeSession and omits the signal option when none is given', async () => {
    const calls: unknown[] = []
    const query = {
      tag: 'query',
      async observeSession(this: { tag: string }, _id: string, options: unknown) {
        calls.push([this.tag, options])
        return lease({ id: 's', cwd: '/w' })
      },
    }
    await createSessionInspector(query as never)!('s')
    expect(calls).toEqual([['query', { projectionMode: 'none' }]])
  })

  it('treats a header without cwd as a missing Session, and still releases the lease', async () => {
    const observation = lease({ id: 'ghost' })
    const inspect = createSessionInspector({ observeSession: async () => observation } as never)!
    await expect(inspect('ghost')).rejects.toThrow(/not found/)
    expect(observation.dispose).toHaveBeenCalledTimes(1)
  })

  it('propagates an unreadable or unknown Session instead of inventing one', async () => {
    const inspect = createSessionInspector({
      observeSession: async () => { throw new Error('SESSION_QUERY_SESSION_NOT_FOUND') },
    } as never)!
    await expect(inspect('missing')).rejects.toThrow('SESSION_QUERY_SESSION_NOT_FOUND')
  })

  it('is undefined when the Host provides no sessionQuery or no observeSession (fail closed, caller reports it)', () => {
    expect(createSessionInspector(undefined)).toBeUndefined()
    expect(createSessionInspector({} as never)).toBeUndefined()
    expect(createSessionInspector({ observeSession: 'nope' } as never)).toBeUndefined()
  })
})
