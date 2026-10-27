// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RoutingSettings } from '../src/client/settings-section.js'
import { ui, view } from './gui-fixture.js'
import questions from '../src/rubric.json' with { type: 'json' }
import { registry } from '../src/strategies/index.js'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const click = async (text: string) => { const button = Array.from(document.querySelectorAll(document.querySelector('[role=menu]') ? '[role=menu] button' : 'button')).find(b => b.textContent === text) as HTMLButtonElement | undefined; expect(button).toBeDefined(); await act(async () => button!.click()) }
const clickLabel = async (label: string) => { await act(async () => (host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click()) }
it('ordinary settings save a sparse patch and never select a session model', async () => {
  const calls: { endpoint: string; payload: any }[] = []
  const rpc = { call: async (_: string, endpoint: string, payload: any) => { calls.push({ endpoint, payload }); return { ok: true, value: view() } } }
  await act(async () => root.render(h(RoutingSettings, { rpc, ui })))
  expect(host.querySelectorAll('[data-tier]')).toHaveLength(0)
  expect(host.querySelector('[role=tablist]')).toBeNull()
  await click('AUTO'); await click('保存')
  expect(calls.find(c => c.endpoint.endsWith('saveSettings'))?.payload).toEqual({ defaultMode: 'AUTO' })
  expect(calls.every(c => /^auto-model-routing\.(settings|saveSettings|setKey)$/.test(c.endpoint))).toBe(true)
})
it('connection button shows pending and local success or failure feedback',async()=>{
 let finish:((value:any)=>void)|undefined
 const rpc={call:async(_:string,endpoint:string)=>endpoint.endsWith('testDecision')?new Promise<any>(resolve=>{finish=resolve}):({ok:true,value:view()})}
 await act(async()=>root.render(h(RoutingSettings,{rpc,ui})))
 await click('测试连接')
 expect(host.querySelector('.amr-test-button')?.textContent).toBe('测试中…')
 expect((host.querySelector('.amr-test-button') as HTMLButtonElement).disabled).toBe(true)
 await act(async()=>finish!({ok:true,value:{kind:'ok',ms:123}}))
 expect(host.querySelector('.amr-test-row')?.textContent).toContain('连接成功 · 123 ms')
 await click('测试连接');await act(async()=>finish!({ok:true,value:{kind:'failed',category:'missing-credential'}}))
 expect(host.querySelector('.amr-test-row')?.textContent).toContain('未配置所选决策服务的 API key')
})
it('service selection clears key drafts and waits for save before key management',async()=>{
 const calls:{endpoint:string;payload:any}[]=[]
 const rpc={call:async(_:string,endpoint:string,payload:any)=>{calls.push({endpoint,payload});const data=view();if(endpoint.endsWith('saveSettings'))data.settings={...data.settings,...payload};return {ok:true,value:data}}}
 await act(async()=>root.render(h(RoutingSettings,{rpc,ui})))
 expect(host.querySelector('select')).toBeNull()
 await clickLabel('决策服务'); await click('TypeSafe 官方')
 expect(host.textContent).toContain('不会沿用原服务的 key')
 expect(host.querySelector('input[type="password"]')?.hasAttribute('disabled')).toBe(true)
 await click('保存')
 expect(calls.find(c=>c.endpoint.endsWith('saveSettings'))?.payload).toEqual({decisionService:{provider:'typesafe'}})
 expect(calls.some(c=>c.endpoint.endsWith('setKey'))).toBe(false)
})
it('preset model menu selects version while custom service keeps model input',async()=>{
 await act(async()=>root.render(h(RoutingSettings,{rpc:{call:async()=>({ok:true,value:view()})},ui})))
 expect(host.querySelector('input[aria-label="决策模型"]')).toBeNull()
 await clickLabel('决策服务');await click('TypeSafe 官方')
 await clickLabel('决策模型');await click('jev-1.14.0')
 expect(host.querySelector('button[aria-label="决策模型"]')?.textContent).toBe('jev-1.14.0')
 await clickLabel('决策服务');await click('自定义 System One')
 expect(host.querySelector('input[aria-label="决策模型"]')).not.toBeNull()
})
it('spec Scenario "旧映射配置不影响路由并在保存时移除" (settings page notice)', async () => {
  const withDeprecated={...view(),deprecated:['childRoutes','mainEfforts','policy']}
  await act(async()=>root.render(h(RoutingSettings,{rpc:{call:async()=>({ok:true,value:withDeprecated})},ui})))
  expect(host.querySelector('[role=status][data-deprecated]')?.textContent).toMatch(/不再生效/)
  expect(host.textContent).toMatch(/下次保存.*移除/)
  expect(host.querySelectorAll('[data-tier]')).toHaveLength(0)
  expect(host.querySelector('[role=tablist]')).toBeNull()
  act(()=>root.unmount()); root=createRoot(host)
  await act(async()=>root.render(h(RoutingSettings,{rpc:{call:async()=>({ok:true,value:{...view(),deprecated:[]}})},ui})))
  expect(host.querySelector('[data-deprecated]')).toBeNull()
})
it('spec Scenario "策略说明来自规则文件与注册表"',async()=>{
  const calls:string[]=[]
  const data=view()
  await act(async()=>root.render(h(RoutingSettings,{rpc:{call:async(_,endpoint)=>{calls.push(endpoint);return {ok:true,value:data}}},ui})))
  const details=host.querySelector('details')!
  expect(details.open).toBe(false)
  expect(details.querySelector('summary')?.textContent).toBe('查看决策策略')
  for(const q of Object.values(questions)){
    expect(details.textContent).toContain(q.instructions)
    for(const text of Object.values(q.criteria))expect(details.textContent).toContain(text)
  }
  for(const s of registry.strategies){expect(details.textContent).toContain(s.label);for(const model of Object.values(s.childModels))expect(details.textContent).toContain(model)}
  expect(host.querySelectorAll('[data-tier]')).toHaveLength(0)
  expect(host.querySelector('[role=tablist]')).toBeNull()
  details.open=true;details.dispatchEvent(new Event('toggle'))
  expect(details.open).toBe(true)
  expect(calls).toEqual(['auto-model-routing.settings'])
  expect((Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='保存') as HTMLButtonElement).disabled).toBe(true)
})
it('spec Scenario "独立保存结果与不泄漏"', async () => {
  const rpc = { call: async (_: string, endpoint: string) => endpoint.endsWith('saveSettings') ? { ok: false, error: { message: 'invalid' } } : { ok: true, value: view() } }
  await act(async () => root.render(h(RoutingSettings, { rpc, ui })))
  const input = host.querySelector('input[type=password]') as HTMLInputElement
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'example-test-value'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
  await click('AUTO'); await click('保存')
  expect(input.value).toBe('')
  expect(host.textContent).toContain('API key 已保存')
  expect(host.textContent).toContain('设置未保存')
  expect(Array.from(host.querySelectorAll('[aria-pressed=true]')).some(el => el.textContent === 'AUTO')).toBe(true)
})
it('unavailable child service and readonly environment key still allow unrelated settings save', async () => {
  const data = view(); data.key.writable = false; data.key.source = 'environment'; data.childAllowlist.status = 'unavailable' as never
  const calls: string[] = []
  const rpc = { call: async (_: string, endpoint: string) => { calls.push(endpoint); return { ok: true, value: data } } }
  await act(async () => root.render(h(RoutingSettings, { rpc, ui })))
  expect((host.querySelector('input[type=password]') as HTMLInputElement).disabled).toBe(true)
  expect(host.textContent).toContain('重启')
  await click('AUTO'); await click('保存')
  expect(calls).toContain('auto-model-routing.saveSettings')
})
