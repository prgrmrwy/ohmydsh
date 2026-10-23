// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createElement as h, act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RoutePicker } from '../src/client/route-picker.js'
import { catalog, ui } from './gui-fixture.js'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const click = async (text: string) => { const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()) }
const key = async (key: string) => { await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))) }
it('waits for anchored hidden surface to become visible before moving keyboard focus', async () => {
  const delayedUi = { ...ui, useAnchoredPosition: ({ open }: { open: boolean }) => {
    const [ready, setReady] = useState(false)
    useEffect(() => { setReady(open) }, [open])
    return ready ? { top: 0, left: 0 } : null
  } }
  const nativeFocus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function(options?: FocusOptions) {
    if (!this.closest('[style*="visibility: hidden"]')) nativeFocus.call(this, options)
  }
  try {
    await act(async () => root.render(h(RoutePicker, { ui: delayedUi, catalog, provider: 'codex', cap: 'high', label: 'route', value: { model: 'gpt-6.1-sol', reasoningEffort: 'high' }, onChange: () => {} })))
    await act(async () => host.querySelector('button')!.click())
    expect(document.activeElement?.textContent).toBe('模型')
    await key('Escape')
    expect(document.querySelector('[role=menu]')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('button'))
  } finally { HTMLElement.prototype.focus = nativeFocus }
})
it('portals two-level menus; filters provider, unavailable models, max and cap; restores focus', async () => {
  const changes: unknown[] = []
  await act(async () => root.render(h(RoutePicker, { ui, catalog, provider: 'codex', cap: 'high', label: 'simple 子会话推荐', value: { model: 'gpt-6.1-sol', reasoningEffort: 'high' }, onChange: v => changes.push(v) })))
  const trigger = host.querySelector('button')!
  await act(async () => trigger.click())
  expect(host.querySelector('[role=menu]')).toBeNull()
  await click('模型')
  expect(document.body.textContent).toContain('GPT Astra')
  expect(document.querySelector('[role=menu]')?.textContent).not.toContain('Claude')
  await key('Escape')
  expect(document.querySelector('[role=menu]')?.textContent).toContain('推理等级')
  await click('推理等级')
  expect(Array.from(document.querySelectorAll('[role=menuitemradio]')).map(el => el.textContent)).toEqual(['low', 'medium', 'high'])
  await click('medium')
  expect(changes).toEqual([{ model: 'gpt-6.1-sol', reasoningEffort: 'medium' }])
  expect(document.activeElement).toBe(trigger)
})
it('changing model keeps a supported effort but clears incompatible effort; keyboard selects', async () => {
  const changes: unknown[] = []
  await act(async () => root.render(h(RoutePicker, { ui, catalog, provider: 'codex', cap: 'xhigh', label: 'route', value: { model: 'gpt-6.1-sol', reasoningEffort: 'xhigh' }, onChange: v => changes.push(v) })))
  await act(async () => host.querySelector('button')!.click())
  await click('模型'); await click('GPT Astra')
  expect(changes).toEqual([{ model: 'gpt-6-astra', reasoningEffort: undefined }])
  await act(async () => root.render(h(RoutePicker, { ui, catalog, provider: 'codex', cap: 'xhigh', label: 'route', value: { model: 'removed', reasoningEffort: 'medium' }, onChange: v => changes.push(v) })))
  expect(host.textContent).toContain('不可用')
  await act(async () => host.querySelector('button')!.click())
  await key('Enter')
  expect(document.querySelector('[role=menu]')?.textContent).not.toContain('removed')
  await key('Home'); await key('ArrowDown'); await key('Enter')
  expect(changes.at(-1)).toEqual({ model: 'gpt-6-luna', reasoningEffort: 'medium' })
})
