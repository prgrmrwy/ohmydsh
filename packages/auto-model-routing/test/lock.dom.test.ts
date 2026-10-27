// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RoutingChip } from '../src/client/index.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, host: HTMLElement
beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

it('a locked chip never sends setMode when clicked', async () => {
  const calls: string[] = []
  const view = { mode: 'MANUAL', policy: 'policy-v2', autoSupport: { supported: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash' } }
  const rpc = { call: async (_channel: string, endpoint: string) => { calls.push(endpoint); return { ok: true, value: view } } }
  await act(async () => { root.render(createElement(RoutingChip, { sessionId: 'S', rpc: rpc as never, initialView: view as never })) })
  const button = host.querySelector('.amr-trigger') as HTMLButtonElement
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.disabled).toBe(false)
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(calls.filter(endpoint => endpoint.endsWith('setMode'))).toHaveLength(0)
})
