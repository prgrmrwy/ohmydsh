// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { apply } from '../src/client/index.js'
import { GuardSettingsSection } from '../src/client/settings.js'
import { GUARD_CONFIG_CHANGED } from '../src/contract.js'
import { DEFAULT_CONFIG } from '../src/config.js'

const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = '' })
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function mount(call: ReturnType<typeof vi.fn>) {
  const blocks = new Map<string, any>()
  const selection = { provider: 'dsh-magpie-connector-claude', model: 'claude/opus' }
  const snapshot = { current: selection, routable: true }
  const store = { getSnapshot: () => snapshot, subscribe: () => () => {} }
  const ctx: any = {
    effect: (fn: any) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: { inject: () => {} }, get: () => ({ rpc: { call } }),
    modelDirectories: { directoryFor: () => ({ store }) },
    sessions: { list: { getSnapshot: () => ({ byId: { s: {} } }), subscribe: () => () => {} } },
    conversation: { blocks: { storeFor: (id: string) => ({ getSnapshot: () => blocks.get(id), subscribe: () => () => {} }), set: (id: string, block: any) => { if (block) blocks.set(id, block); else blocks.delete(id) } } },
  }
  apply(ctx)
  return blocks
}

it('unblocks Magpie after policy arrives while Geo remains pending; refresh failure blocks it again', async () => {
  vi.useFakeTimers()
  let fail = false
  const call = vi.fn(async (_channel, endpoint) => {
    if (endpoint === 'policy') {
      if (fail) throw new Error('offline')
      return { ok: true, value: { exemptProviders: ['dsh-magpie-connector-claude'] } }
    }
    return new Promise(() => {}) // Geo never finishes
  })
  const blocks = mount(call)
  expect(blocks.has('s')).toBe(true)
  await flush()
  expect(blocks.has('s')).toBe(false)
  expect(call.mock.calls.map(c => c[1])).toEqual(['policy', 'check'])
  fail = true
  window.dispatchEvent(new Event(GUARD_CONFIG_CHANGED))
  await flush()
  expect(blocks.has('s')).toBe(true)
})

it('refreshes policy periodically after a successful Geo answer and applies revocation', async () => {
  vi.useFakeTimers()
  let providers = ['dsh-magpie-connector-claude']
  const blocks = mount(vi.fn(async (_channel, endpoint) => ({ ok: true, value: endpoint === 'policy' ? { exemptProviders: providers } : { verdict: 'blocked', degraded: false } })))
  await flush()
  expect(blocks.has('s')).toBe(false)
  providers = []
  await vi.advanceTimersByTimeAsync(10_000)
  expect(blocks.has('s')).toBe(true)
})

it('ignores stale policy responses after a forced settings refresh', async () => {
  vi.useFakeTimers()
  let resolveOld: (value: any) => void = () => {}
  let calls = 0
  const blocks = mount(vi.fn(async (_channel, endpoint) => {
    if (endpoint === 'policy') {
      if (++calls === 1) return new Promise(resolve => { resolveOld = resolve })
      return { ok: true, value: { exemptProviders: [] } }
    }
    return { ok: true, value: { verdict: 'unknown', degraded: true } }
  }))
  window.dispatchEvent(new Event(GUARD_CONFIG_CHANGED))
  await flush()
  resolveOld({ ok: true, value: { exemptProviders: ['dsh-magpie-connector-claude'] } })
  await flush()
  expect(blocks.has('s')).toBe(true)
})

it('settings saves the list, preserves timing fields, emits refresh, and allows an empty list', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const config = { ...DEFAULT_CONFIG, exemptProviders: ['dsh-magpie-connector-claude'], timeoutMs: 1234, ttlMs: 98765 }
  const call = vi.fn(async (_channel, endpoint, params) => {
    if (endpoint === 'set-config') return { ok: true, value: {} }
    return { ok: true, value: { verdict: 'unknown', degraded: true, config, configEpoch: '1' } }
  })
  const changed = vi.fn()
  window.addEventListener(GUARD_CONFIG_CHANGED, changed)
  disposers.push(() => window.removeEventListener(GUARD_CONFIG_CHANGED, changed))
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  disposers.push(() => { act(() => root.unmount()) })
  await act(async () => { root.render(createElement(GuardSettingsSection, { rpc: { call } as never, t: key => key })); await flush() })
  const save = () => [...node.querySelectorAll('button')].find(b => b.textContent === 'save')!
  await act(async () => { save().click(); await flush() })
  expect(call.mock.calls.find(c => c[1] === 'set-config')?.[2]).toEqual(config)
  expect(changed).toHaveBeenCalledTimes(1)
  const input = node.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { save().click(); await flush() })
  expect(call.mock.calls.filter(c => c[1] === 'set-config').at(-1)?.[2]).toMatchObject({ exemptProviders: [], timeoutMs: 1234, ttlMs: 98765 })
})
