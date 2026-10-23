// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RoutingSettings } from '../src/client/settings-section.js'
import { ui, view } from './gui-fixture.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
async function click(text: string, scope: ParentNode = document) { const button = Array.from(scope.querySelectorAll('button')).find(b => b.textContent === text)!; expect(button).toBeDefined(); await act(async () => button.click()) }
it('cap conflicts include nonvisible explicit cells and reset deletes only the override', async () => {
  const data = { ...view(), settings: { ...view().settings, mainEfforts: { claude: { complex: 'high' as const } } } }
  const calls: unknown[] = []
  const rpc = { call: async (_: string, endpoint: string, payload: unknown) => { if (endpoint.endsWith('saveSettings')) calls.push(payload); return { ok: true, value: data } } }
  await act(async () => root.render(h(RoutingSettings, { ui, rpc })))
  await click('GPT')
  await click('medium', host.querySelector('[aria-label="推理强度上限"]')!)
  expect(host.textContent).toContain('超过推理强度上限')
  expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent === '保存')!.disabled).toBe(true)
  await click('Claude')
  const row = host.querySelector('[data-tier=complex]')!
  await click('恢复默认', row)
  expect(row.querySelector('[aria-label="complex 主会话推理等级"]')?.textContent).toContain('默认（随模型）')
  await click('保存')
  expect(calls).toEqual([{ effortCap: 'medium', mainEfforts: { claude: { complex: null } } }])
})
it('legacy family remains visibly invalid until explicit family reset; unrelated edits preserve it', async () => {
  const data = { ...view(), settings: { ...view().settings, mainEfforts: { claude: { 'claude-opus-5-5': { simple: 'high' } } } } }
  const calls: unknown[] = []
  const rpc = { call: async (_: string, endpoint: string, payload: unknown) => { if (endpoint.endsWith('saveSettings')) calls.push(payload); return { ok: true, value: data } } }
  await act(async () => root.render(h(RoutingSettings, { ui, rpc })))
  expect(host.querySelector('[aria-label="simple 主会话推理等级"]')?.textContent).toContain('无效配置')
  expect(host.textContent).toContain('不会按默认值执行')
  await click('AUTO'); await click('保存')
  expect(calls).toEqual([{ defaultMode: 'AUTO' }])
  await click('恢复本体系默认值')
  expect(host.querySelector('[aria-label="simple 主会话推理等级"]')?.textContent).toContain('默认（随模型）')
  await click('保存')
  expect(calls.at(-1)).toEqual({ mainEfforts: { claude: null } })
})
it('editing after a whole-family reset does not resurrect other overrides', async () => {
  const data = { ...view(), settings: { ...view().settings, mainEfforts: { claude: { 'old-model': { complex: 'high' } } } } }
  const calls: unknown[] = []
  const rpc = { call: async (_: string, endpoint: string, payload: unknown) => { if (endpoint.endsWith('saveSettings')) calls.push(payload); return { ok: true, value: data } } }
  await act(async () => root.render(h(RoutingSettings, { ui, rpc })))
  await click('恢复本体系默认值')
  await act(async () => (host.querySelector('[aria-label="simple 主会话推理等级"]') as HTMLButtonElement).click())
  await click('medium', document.querySelector('[role=menu]')!)
  await click('保存')
  expect(calls).toEqual([{ mainEfforts: { claude: { simple: 'medium', standard: null, complex: null, escalated: null } } }])
})
it('no common family effort disables only main cells while allowing unrelated settings', async () => {
  const data = view(); data.models[0]!.reasoningEfforts = ['low']; data.models[1]!.reasoningEfforts = ['high']
  await act(async () => root.render(h(RoutingSettings, { ui, rpc: { call: async () => ({ ok: true, value: data }) } })))
  expect((host.querySelector('[aria-label="simple 主会话推理等级"]') as HTMLButtonElement).disabled).toBe(true)
  await click('AUTO')
  expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent === '保存')!.disabled).toBe(false)
})
it('key failure/config success retains secret for retry and explicitly reports both outcomes', async () => {
  const rpc = { call: async (_: string, endpoint: string) => endpoint.endsWith('setKey') ? { ok: false, error: { message: 'do not expose raw server data' } } : { ok: true, value: view() } }
  await act(async () => root.render(h(RoutingSettings, { rpc, ui })))
  const input = host.querySelector('input[type=password]') as HTMLInputElement
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'example-test-value'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('AUTO'); await click('保存')
  expect(input.value).toBe('example-test-value')
  expect(host.textContent).toContain('API key 未保存；设置已保存')
  expect(host.textContent).not.toContain('do not expose raw server data')
})
