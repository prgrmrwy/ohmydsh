// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RoutingChip } from '../src/client/index.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, host: HTMLElement
beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const flush = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

it('spec Scenario "子会话不渲染芯片且停止轮询"', async () => {
  const calls: Record<string, number> = {}
  const rpc = { call: async (_channel: string, _endpoint: string, payload: { sessionId: string }) => {
    calls[payload.sessionId] = (calls[payload.sessionId] ?? 0) + 1
    return { ok: true, value: payload.sessionId === 'C' ? { applicable: false } : { mode: 'MANUAL' } }
  } }
  await act(async () => { root.render(createElement(RoutingChip, { sessionId: 'C', rpc: rpc as never })) })
  await flush(10_000)
  expect(host.querySelector('.amr-trigger')).toBeNull()
  expect(calls.C).toBe(1)
  await act(async () => { root.render(createElement(RoutingChip, { sessionId: 'S', rpc: rpc as never })) })
  await flush(4_000)
  expect(host.querySelector('.amr-trigger')).not.toBeNull()
  expect(calls.S).toBeGreaterThanOrEqual(2)
})

it('spec Scenario "状态读取失败的普通会话保持原行为"', async () => {
  let fail = true, count = 0
  const rpc = { call: async () => { count++; if (fail) throw new Error('offline'); return { ok: true, value: { mode: 'MANUAL' } } } }
  await act(async () => { root.render(createElement(RoutingChip, { sessionId: 'S', rpc: rpc as never })) })
  expect(host.querySelector('.amr-trigger')).not.toBeNull()
  fail = false
  await flush(6_000)
  expect(count).toBeGreaterThanOrEqual(3)
  expect(host.textContent).toContain('MANUAL')
})
