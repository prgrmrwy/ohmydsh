// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { buttonByText, deferred, fakeApi, flush, inputValue, ok, settingsView } from './client-support/fake-api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = []
afterEach(() => { for (const entry of mounted.splice(0)) { act(() => entry.root.unmount()); entry.host.remove() } })

const view = {
  lines: [
    { id: 'a1b2c3d4', baseUrl: 'http://lan.test:3425/v1', accessMode: 'direct', complete: true, key: { configured: true, writable: true } },
    { id: '9f0e7d6c', baseUrl: 'https://public.test/v1', accessMode: 'direct', complete: true, key: { configured: true, writable: true } },
  ],
  activeLineId: 'a1b2c3d4',
}
const cardsFor = (user: string) => ({ status: 'ok', cards: [{ provider: 'claude', user, windows: [{ name: '5h', used: 10 }] }] })

type Handler = () => Promise<{ status: number; body: unknown }> | { status: number; body: unknown }
async function mount(handlers: { settings?: Handler; save?: Handler; cards?: Handler } = {}) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({
    'GET settings': handlers.settings ?? (() => ok(settingsView(view))),
    'GET cards': handlers.cards ?? (() => ok(cardsFor('u1'))),
    'POST settings': handlers.save ?? (() => ok(settingsView({ ...view }))),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
  mounted.push({ root, host })
  return { host, fake }
}
const cardCount = (host: HTMLElement) => host.querySelectorAll('.dmg-card').length

test('保存待响应期间旧卡片已不可见（D9 验收 1）', async () => {
  const gate = deferred<{ status: number; body: unknown }>()
  const { host } = await mount({ save: () => gate.promise })
  expect(cardCount(host)).toBe(1)
  const key = host.querySelector('[data-line-id="a1b2c3d4"] input[type="password"]') as HTMLInputElement
  await act(async () => { inputValue(key, 'K-new') }); await flush()
  await act(async () => { (buttonByText(host, '保存') as HTMLButtonElement).click() }); await flush()
  // The host may already be writing the new key; the old key's cards must be gone right now.
  expect(cardCount(host)).toBe(0)
  await act(async () => { gate.resolve(ok(settingsView(view))) }); await flush()
})

test('生效 key 已写但后续写入失败时不恢复旧卡片（D9 验收 2）', async () => {
  let cardsCalls = 0
  const { host, fake } = await mount({
    save: () => ({ status: 500, body: { error: 'MAGPIE_SETTINGS_WRITE_FAILED: partial' } }),
    cards: () => { cardsCalls++; return ok(cardsFor(cardsCalls === 1 ? 'u1' : 'u2')) },
  })
  expect(host.textContent).toContain('u1')
  const key = host.querySelector('[data-line-id="a1b2c3d4"] input[type="password"]') as HTMLInputElement
  await act(async () => { inputValue(key, 'K-new') }); await flush()
  await act(async () => { (buttonByText(host, '保存') as HTMLButtonElement).click() }); await flush()
  // Failure path: never restore u1; reread settings + cards and show the host's truth (u2).
  expect(host.textContent).toContain('未保存')
  expect(fake.calls.filter(call => call.method === 'GET' && call.path === 'settings').length).toBeGreaterThanOrEqual(2)
  expect(cardsCalls).toBeGreaterThanOrEqual(2)
  expect(host.textContent).not.toContain('u1')
  expect(host.textContent).toContain('u2')
})

test('纯备用线路提交保留卡片且不额外读卡片（D9 验收 3）', async () => {
  const gate = deferred<{ status: number; body: unknown }>()
  const { host, fake } = await mount({ save: () => gate.promise })
  expect(cardCount(host)).toBe(1)
  const cardsCallsBefore = fake.calls.filter(call => call.method === 'GET' && call.path === 'cards').length
  act(() => buttonByText(host.querySelector('[data-line-id="9f0e7d6c"]') as HTMLElement, '展开')!.click()); await flush()
  const spareAddress = host.querySelector('[data-line-id="9f0e7d6c"] input') as HTMLInputElement
  await act(async () => { inputValue(spareAddress, 'https://spare.test/v1') }); await flush()
  await act(async () => { (buttonByText(host, '保存') as HTMLButtonElement).click() }); await flush()
  // Waiting for the host: the spare line is not active, so the cards stay exactly as they were.
  expect(cardCount(host)).toBe(1)
  expect(host.textContent).toContain('u1')
  await act(async () => { gate.resolve(ok(settingsView(view))) }); await flush()
  expect(cardCount(host)).toBe(1)
  expect(fake.calls.filter(call => call.method === 'GET' && call.path === 'cards')).toHaveLength(cardsCallsBefore)
})
