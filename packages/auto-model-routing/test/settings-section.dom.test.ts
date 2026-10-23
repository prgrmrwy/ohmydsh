// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RoutingSettings } from '../src/client/settings-section.js'
import { ui, view } from './gui-fixture.js'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const click = async (text: string) => { const button = Array.from(document.querySelectorAll(document.querySelector('[role=menu]') ? '[role=menu] button' : 'button')).find(b => b.textContent === text) as HTMLButtonElement | undefined; expect(button).toBeDefined(); await act(async () => button!.click()) }
const clickLabel = async (label: string) => { await act(async () => (host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click()) }
it('four rows, source criteria, retained family drafts and sparse patch; never selects a session model', async () => {
  const calls: { endpoint: string; payload: any }[] = []
  const rpc = { call: async (_: string, endpoint: string, payload: any) => { calls.push({ endpoint, payload }); return { ok: true, value: view() } } }
  await act(async () => root.render(h(RoutingSettings, { rpc, ui })))
  expect(host.querySelectorAll('[data-tier]')).toHaveLength(4)
  expect(Array.from(host.querySelectorAll('[data-tooltip]')).map(el => el.getAttribute('data-tooltip'))).toEqual(Object.values(view().criteria))
  expect(host.querySelector('[aria-label="主会话模型"]')).toBeNull()
  expect(host.querySelector('[aria-label="simple 主会话推理等级"]')?.textContent).toContain('默认（随模型）')
  await clickLabel('simple 主会话推理等级'); await click('medium')
  await click('GPT')
  expect(host.querySelector('[aria-label="simple 主会话推理等级"]')?.textContent).toContain('默认（随模型）')
  await click('Claude')
  expect(host.querySelector('[aria-label="simple 主会话推理等级"]')?.textContent).toContain('medium')
  await click('保存')
  expect(calls.find(c => c.endpoint.endsWith('saveSettings'))?.payload).toEqual({ mainEfforts: { claude: { simple: 'medium' } } })
  expect(calls.every(c => /^auto-model-routing\.(settings|saveSettings|setKey)$/.test(c.endpoint))).toBe(true)
})
it('family menu intersects every current model and cap without using child allowlist', async () => {
  const data = view(); data.models[1]!.reasoningEfforts = ['medium', 'high']
  const rpc = { call: async () => ({ ok: true, value: data }) }
  await act(async () => root.render(h(RoutingSettings, { rpc, ui })))
  await clickLabel('simple 主会话推理等级')
  expect(Array.from(document.querySelectorAll('[role=menuitemradio]')).map(el => el.textContent)).toEqual(['medium', 'high'])
  await click('medium'); await click('GPT')
  await clickLabel('simple 主会话推理等级')
  expect(Array.from(document.querySelectorAll('[role=menuitemradio]')).map(el => el.textContent)).toEqual(['low', 'medium'])
  await click('low')
  await clickLabel('simple 子会话推荐'); await click('推理等级')
  expect(Array.from(document.querySelectorAll('[role=menuitemradio]')).map(el => el.textContent)).toEqual(['low', 'medium', 'high', 'xhigh'])
  await click('medium')
})
it('key success/config failure clears only secret and reports partial save without losing drafts', async () => {
  const rpc = { call: async (_: string, endpoint: string) => endpoint.endsWith('saveSettings') ? { ok: false, error: { message: 'invalid' } } : { ok: true, value: view() } }
  await act(async () => root.render(h(RoutingSettings, { rpc, ui })))
  const input = host.querySelector('input[type=password]') as HTMLInputElement
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'example-test-value'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
  await click('AUTO'); await click('保存')
  expect(input.value).toBe('')
  expect(host.textContent).toContain('API key 已保存')
  expect(host.textContent).toContain('设置未保存')
  expect(host.querySelector('[aria-pressed=true]')?.textContent).toBe('AUTO')
})
it('unavailable child service and readonly environment key still allow unrelated settings save', async () => {
  const data = view(); data.key.writable = false; data.key.source = 'environment'; data.childAllowlist.status = 'unavailable' as never
  const calls: string[] = []
  const rpc = { call: async (_: string, endpoint: string) => { calls.push(endpoint); return { ok: true, value: data } } }
  await act(async () => root.render(h(RoutingSettings, { rpc, ui })))
  expect((host.querySelector('input[type=password]') as HTMLInputElement).disabled).toBe(true)
  expect(host.textContent).toContain('重启')
  expect((host.querySelector('[aria-label="simple 子会话推荐"]') as HTMLButtonElement).disabled).toBe(true)
  await click('AUTO'); await click('保存')
  expect(calls).toContain('auto-model-routing.saveSettings')
})
