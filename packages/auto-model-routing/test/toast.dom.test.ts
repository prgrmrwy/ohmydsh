// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RoutingChip } from '../src/client/index.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const decision = (id: number) => ({ id, source: 'main', tier: 'complex', effort: 'xhigh', confidence: 0.9, probabilities: { complex: 0.9, standard: 0.1 }, ms: 500 })
let root: Root, host: HTMLElement
beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

// Each session answers polls from its own queue; the last value repeats.
function rpcFor(queues: Record<string, unknown[]>) {
 return { call: async (_c: string, _e: string, body: { sessionId: string }) => {
  const q = queues[body.sessionId]!
  return { ok: true, value: q.length > 1 ? q.shift() : q[0] }
 } }
}
const toast = () => document.body.querySelector('.amr-toast')?.textContent ?? null
const poll = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(3000) }) }
const mount = async (sessionId: string, rpc: unknown) => { await act(async () => { root.render(createElement(RoutingChip, { sessionId, rpc: rpc as never })) }) }

it('first poll only primes; a new id shows once and expires after 3 seconds', async () => {
 const rpc = rpcFor({ S: [{ mode: 'AUTO', decision: decision(3) }, { mode: 'AUTO', decision: decision(3) }, { mode: 'AUTO', decision: decision(4) }] })
 await mount('S', rpc)
 expect(toast()).toBeNull()            // id 3 existed before mounting
 await poll(); expect(toast()).toBeNull() // same id again
 await poll(); expect(toast()).toContain('主会话判断 · complex → xhigh')
 expect(toast()).toContain('standard 10% / complex 90%')
 expect(toast()).not.toContain('置信')
 await act(async () => { await vi.advanceTimersByTimeAsync(2900) })
 expect(toast()).toContain('主会话判断')
 await act(async () => { await vi.advanceTimersByTimeAsync(100) })
 expect(toast()).toBeNull()
 await poll(); expect(toast()).toBeNull() // id 4 never re-shows
})

it('switching session does not show the other session\'s old decision', async () => {
 const rpc = rpcFor({ A: [{ mode: 'AUTO', decision: decision(7) }], B: [{ mode: 'AUTO', decision: decision(3) }] })
 await mount('A', rpc)
 await mount('B', rpc)
 expect(toast()).toBeNull()
 await poll(); expect(toast()).toBeNull()
})

it('toast still disappears when the decision vanishes before it expires', async () => {
 const queue = [{ mode: 'AUTO' }, { mode: 'AUTO', decision: decision(5) }]
 const rpc = { call: async (_c: string, endpoint: string) => ({ ok: true, value: endpoint.endsWith('setMode') ? { mode: 'MANUAL' } : (queue.length > 1 ? queue.shift() : queue[0]) }) }
 await mount('S', rpc)
 await poll(); expect(toast()).toContain('主会话判断')
 // Toggling within the second returns a view without `decision` (e.g. switch off); the hint must still go away.
 await act(async () => { host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
 await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
 expect(toast()).toBeNull()
})

it('toast is visible while the composer hides the chip', async () => {
 // The official composer hides the whole right-side controls (`hidden`) while the agent runs,
 // which is exactly when Jev decides; the hint must not live inside that hidden subtree.
 const hidden = document.createElement('div'); hidden.hidden = true; host.append(hidden)
 act(() => root.unmount()); root = createRoot(hidden)
 const rpc = rpcFor({ S: [{ mode: 'AUTO' }, { mode: 'AUTO', decision: decision(9) }] })
 await act(async () => { root.render(createElement(RoutingChip, { sessionId: 'S', rpc: rpc as never })) })
 await poll()
 const el = document.body.querySelector('.amr-toast')
 expect(el?.textContent).toContain('主会话判断')
 expect(hidden.contains(el)).toBe(false)
})

it('toast is horizontally centred on the chip', async () => {
 const rpc = rpcFor({ S: [{ mode: 'AUTO' }, { mode: 'AUTO', decision: decision(11) }] })
 const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 500, width: 80, height: 28, right: 280, bottom: 528, x: 200, y: 500, toJSON() {} } as DOMRect)
 try {
  await mount('S', rpc)
  await poll()
  const el = document.body.querySelector('.amr-toast') as HTMLElement
  // Centre of the chip is 200 + 80/2 = 240; the hint is shifted by half its own width.
  expect(el.style.left).toBe('240px')
  expect(el.style.top).toBe('494px')
  expect(el.className).toContain('amr-toast')
 } finally { spy.mockRestore() }
})
