// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement as h, act, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LabelButton, type LabelUi } from '../src/client/label.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

// Test doubles for the official primitives: they expose their props as data attributes.
const ui: LabelUi = {
  Tooltip: ({ label, side, children }: { label: string; side?: string; children: ReactElement }) => h('span', { 'data-tooltip': label, 'data-side': side }, children),
  Menu: ({ open, anchor, items, onSelect, selectedId }: { open: boolean; anchor: ReactNode; items: readonly ({ id: string; label: string } | { type: 'label'; id: string; text: string })[]; onSelect: (id: string) => void; selectedId?: string }) =>
    h('span', { 'data-menu': open ? 'open' : 'closed' }, anchor, open ? items.map(item => 'type' in item
      ? h('div', { key: item.id, role: 'presentation' }, item.text)
      : h('button', { key: item.id, role: 'menuitem', 'data-checked': item.id === selectedId ? 'true' : undefined, onClick: () => onSelect(item.id) }, item.label)) : null),
  Icon: () => h('svg', { 'data-icon': 'gauge' }),
}
type Call = { endpoint: string; payload: { sessionId: string; messageId: string; label?: string; feedback?: string | null } }
function rpcFrom(answer: (payload: Call['payload']) => { ok: boolean; value?: unknown }) {
  const calls: Call[] = []
  return { calls, rpc: { call: async (_channel: string, endpoint: string, payload: Call['payload']) => { calls.push({ endpoint, payload }); return answer(payload) } } }
}
const mount = async (messageId: string, rpc: unknown) => { await act(async () => { root.render(h(LabelButton, { sessionId: 'S1', messageId, rpc: rpc as never, ui })) }) }
const tooltip = () => host.querySelector('[data-tooltip]')?.getAttribute('data-tooltip')

it('observes only after three continuous foreground seconds and cleans up',async()=>{
 vi.useFakeTimers();let intersect!:(entries:unknown[])=>void
 const disconnect=vi.fn()
 vi.stubGlobal('IntersectionObserver',class {constructor(cb:(entries:unknown[])=>void){intersect=cb}observe(){}disconnect=disconnect})
 vi.spyOn(document,'hasFocus').mockReturnValue(true)
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
 const {rpc,calls}=rpcFrom(()=>({ok:true,value:{depth:'baseline',effort:'medium',model:'sol'}}))
 try{
  await mount('m',rpc)
  intersect([{isIntersecting:true,intersectionRatio:1}]);await vi.advanceTimersByTimeAsync(1000)
  intersect([{isIntersecting:false,intersectionRatio:0}]);await vi.advanceTimersByTimeAsync(3000)
  expect(calls.filter(c=>c.endpoint.endsWith('.observe'))).toHaveLength(0)
  intersect([{isIntersecting:true,intersectionRatio:1}]);await vi.advanceTimersByTimeAsync(2999)
  expect(calls.filter(c=>c.endpoint.endsWith('.observe'))).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1);await vi.advanceTimersByTimeAsync(6000)
  expect(calls.filter(c=>c.endpoint.endsWith('.observe'))).toHaveLength(1)
 }finally{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()}
})
it('resets the exposure timer on hidden pages and focus loss',async()=>{
 vi.useFakeTimers();let intersect!:(entries:unknown[])=>void;let state:DocumentVisibilityState='visible';let focused=true
 const disconnect=vi.fn()
 vi.stubGlobal('IntersectionObserver',class {constructor(cb:(entries:unknown[])=>void){intersect=cb}observe(){}disconnect=disconnect})
 vi.spyOn(document,'hasFocus').mockImplementation(()=>focused)
 vi.spyOn(document,'visibilityState','get').mockImplementation(()=>state)
 const {rpc,calls}=rpcFrom(()=>({ok:true,value:{depth:'baseline',effort:'medium',model:'sol'}}))
 try{
  await mount('m',rpc);intersect([{isIntersecting:true,intersectionRatio:1}])
  await vi.advanceTimersByTimeAsync(2000);state='hidden';document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(5000);state='visible';document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(2000);focused=false;window.dispatchEvent(new Event('blur'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(calls.filter(c=>c.endpoint.endsWith('.observe'))).toHaveLength(0)
  focused=true;window.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(3000)
  expect(calls.filter(c=>c.endpoint.endsWith('.observe'))).toHaveLength(1)
  await act(async()=>{root.render(null)});expect(disconnect).toHaveBeenCalled()
 }finally{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()}
})
it('unbound replies do not register an exposure observer',async()=>{
 const observer=vi.fn();vi.stubGlobal('IntersectionObserver',observer)
 try{
  await mount('unbound',rpcFrom(()=>({ok:true,value:{}})).rpc)
  await mount('legacy',rpcFrom(()=>({ok:true,value:{tier:'simple'}})).rpc)
  expect(observer).not.toHaveBeenCalled()
 }finally{vi.unstubAllGlobals()}
})
it('spec Scenario "修改撤销"',async()=>{
 let feedback:string|null|undefined;let fail=false
 const {rpc}=rpcFrom(p=>{if(Object.hasOwn(p,'feedback')){if(fail)return {ok:false};feedback=p.feedback}return {ok:true,value:{depth:'baseline',effort:'medium',model:'sol',feedback}}})
 await mount('new',rpc)
 const choose=async(text:string)=>{await act(async()=>{(host.querySelector('button[aria-label]') as HTMLButtonElement).click()});await act(async()=>{(Array.from(host.querySelectorAll('[role=menuitem]')).find(e=>e.textContent===text) as HTMLButtonElement).click()})}
 await choose('投入偏高');expect(tooltip()).toContain('你反馈：投入偏高')
 await choose('撤销反馈');expect(tooltip()).not.toContain('你反馈')
 fail=true;await choose('分配合适');expect(host.querySelector('[role=alert]')?.textContent).toBe('反馈未保存，请重试');expect(tooltip()).not.toContain('你反馈')
})
it('spec Scenario "label 响应以绑定是否存在区分"', async () => {
  vi.useFakeTimers(); let intersect!: (entries: unknown[]) => void
  const created = vi.fn()
  vi.stubGlobal('IntersectionObserver', class { constructor(cb: (entries: unknown[]) => void) { created(); intersect = cb } observe() {} disconnect() {} })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const m1 = { sessionId: 'S1', messageId: 'm1', decisionId: 5, depth: 'higher', model: 'claude-opus-5-5', effort: 'high' }
  const { rpc, calls } = rpcFrom(p => ({ ok: true, value: p.messageId === 'm1' ? m1 : {} }))
  try {
    await mount('m2', rpc)
    expect(host.innerHTML).toBe('')
    expect(created).not.toHaveBeenCalled()
    await mount('m1', rpc)
    expect(tooltip()).toMatch(/^AUTO 分配：higher → high · claude-opus-5-5/)
    expect(host.querySelector('[data-icon=gauge]')).not.toBeNull()
    intersect([{ isIntersecting: true, intersectionRatio: 1 }]); await vi.advanceTimersByTimeAsync(3000)
    expect(calls.filter(c => c.endpoint.endsWith('.observe')).map(c => c.payload.messageId)).toEqual(['m1'])
    expect(calls.every(c => c.payload.label === undefined)).toBe(true)
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
