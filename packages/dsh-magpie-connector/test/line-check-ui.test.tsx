// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { buttonByText, deferred, expandLine, fakeApi, flush, inputValue, ok, settingsView } from './client-support/fake-api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = []
afterEach(() => { for (const entry of mounted.splice(0)) { act(() => entry.root.unmount()); entry.host.remove() } })

type Handler = (request: { body?: unknown }) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>

async function mount(view: Record<string, unknown>, lineCheck: Handler) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({
    'GET settings': () => ok(settingsView(view)),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'POST line-check': request => lineCheck(request),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
  mounted.push({ root, host })
  return { host, fake }
}
const twoLines = {
  lines: [
    { id: 'a1b2c3d4', baseUrl: 'http://lan.test:3425/v1', accessMode: 'direct', complete: true, key: { configured: true, writable: true } },
    { id: '9f0e7d6c', baseUrl: 'https://public.test/v1', accessMode: 'direct', complete: true, key: { configured: true, writable: true } },
  ],
  activeLineId: 'a1b2c3d4',
  lastSyncAt: '2026-10-25T10:00:00Z',
  groups: [{ provider: 'claude', models: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }],
}
const card = (host: HTMLElement, id: string) => host.querySelector(`[data-line-id="${id}"]`) as HTMLElement
const checkLine = async (host: HTMLElement, id: string) => {
  expandLine(host, id)
  await flush()
  const target = card(host, id)
  const run = buttonByText(target, '检查线路')
  expect(run).not.toBeUndefined()
  await act(async () => { run!.click() }); await flush()
}
const checkButton = (host: HTMLElement) => Array.from(host.querySelectorAll('[data-check-run]'))

test('test_line_check_ui_01 spec Scenario "与缓存对比：一致或多出 / 缺少"', async () => {
  let models = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const { host, fake } = await mount(twoLines, () => ok({ kind: 'ok', latencyMs: 42, modelCount: models.length, models, testedAt: '2026-10-30T03:00:00Z' }))
  // Configured lines start collapsed, even the active one; the card must open for its check UI.
  expect(card(host, 'a1b2c3d4').getAttribute('data-expanded')).toBe('false')
  await checkLine(host, 'a1b2c3d4')
  const same = card(host, 'a1b2c3d4').querySelector('[data-check-kind="ok"]')!
  expect(same.textContent).toContain('3 个模型')
  expect(same.textContent).toContain('与缓存目录一致')
  expect(same.textContent).toContain('缓存于')
  expect(same.textContent).not.toContain('多 ')
  expect(fake.calls.filter(call => call.method === 'POST' && call.path === 'settings')).toHaveLength(0)

  models = [{ id: 'a' }, { id: 'b' }, { id: 'x' }]
  await checkLine(host, 'a1b2c3d4')
  const target = card(host, 'a1b2c3d4')
  expect(target.querySelector('[data-check-kind="ok"]')!.textContent).toContain('多 1 · 少 1')
  const details = target.querySelector('.dmg-check-models') as HTMLElement
  expect(details.textContent).toContain('多出：x')
  expect(details.textContent).toContain('缺少：c')
  expect(details.textContent).not.toContain('共同：')
  expect(fake.calls.filter(call => call.method === 'POST' && call.path === 'settings')).toHaveLength(0)
})

test('test_line_check_ui_02 spec Scenario "快照只读"', async () => {
  const { host, fake } = await mount(twoLines, () => ok({ kind: 'ok', latencyMs: 42, modelCount: 2, models: [{ id: 'a' }, { id: 'b' }], testedAt: '2026-10-30T03:00:00Z' }))
  await checkLine(host, 'a1b2c3d4')
  const area = card(host, 'a1b2c3d4').querySelector('.dmg-check') as HTMLElement
  expect(area.querySelectorAll('input, select, textarea')).toHaveLength(0)
  expect(buttonByText(area, '刷新')).toBeUndefined()
  expect(area.textContent).toContain('a、b')
  expect(fake.calls.filter(call => call.method === 'POST' && call.path === 'settings')).toHaveLength(0)
})

test('test_line_check_ui_03 spec Scenario "缓存基准诚实，不断言当前线路"', async () => {
  // Active line already switched to line 2, but the catalog is still the inherited one from line 1.
  const view = { ...twoLines, activeLineId: '9f0e7d6c', lastSyncAt: '2026-10-24T09:00:00Z' }
  const { host } = await mount(view, () => ok({ kind: 'ok', latencyMs: 7, modelCount: 3, models: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], testedAt: '2026-10-30T03:00:00Z' }))
  await checkLine(host, '9f0e7d6c')
  const line = card(host, '9f0e7d6c').querySelector('[data-check-kind="ok"]')!
  expect(line.textContent).toContain('与缓存目录一致')
  expect(line.textContent).toContain('缓存于')
  const page = host.textContent ?? ''
  expect(page).not.toContain('与当前线路一致')
  expect(page).not.toContain('同一个网关')
})

test('test_line_check_ui_04 spec Scenario "失效事件与迟到结果"', async () => {
  const gate = deferred<{ status: number; body: unknown }>()
  let pending = false
  const { host, fake } = await mount(twoLines, () => pending ? gate.promise : ok({ kind: 'ok', latencyMs: 9, modelCount: 1, models: [{ id: 'a' }], testedAt: '2026-10-30T03:00:00Z' }))

  // (a) Editing this card's address drops its snapshot.
  await checkLine(host, 'a1b2c3d4')
  expect(card(host, 'a1b2c3d4').querySelector('[data-check-kind]')).not.toBeNull()
  const address = card(host, 'a1b2c3d4').querySelector('input') as HTMLInputElement
  await act(async () => { inputValue(address, 'http://other.test:3425/v1') }); await flush()
  expect(card(host, 'a1b2c3d4').querySelector('[data-check-kind]')).toBeNull()

  // (b) Editing another card does not drop it (expanding another card only collapses this one).
  await checkLine(host, 'a1b2c3d4')
  act(() => expandLine(host, '9f0e7d6c')); await flush()
  const otherAddress = card(host, '9f0e7d6c').querySelector('input') as HTMLInputElement
  await act(async () => { inputValue(otherAddress, 'https://edited.test/v1') }); await flush()
  act(() => expandLine(host, 'a1b2c3d4')); await flush()
  expect(card(host, 'a1b2c3d4').querySelector('[data-check-kind]')).not.toBeNull()

  // (c) A late result does not come back after the draft changed while it was in flight.
  pending = true
  const target = card(host, 'a1b2c3d4')
  await act(async () => { (buttonByText(target, '检查线路') as HTMLButtonElement).click() }); await flush()
  await act(async () => { inputValue(target.querySelector('input') as HTMLInputElement, 'http://late.test:3425/v1') }); await flush()
  pending = false
  await act(async () => { gate.resolve(ok({ kind: 'ok', latencyMs: 11, modelCount: 1, models: [{ id: 'a' }], testedAt: '2026-10-30T03:00:00Z' })) }); await flush()
  expect(card(host, 'a1b2c3d4').querySelector('[data-check-kind]')).toBeNull()

  // (d) Saving drops every snapshot.
  pending = false
  await checkLine(host, 'a1b2c3d4')
  expect(card(host, 'a1b2c3d4').querySelector('[data-check-kind]')).not.toBeNull()
  const save = buttonByText(host, '保存') as HTMLButtonElement
  expect(save.disabled).toBe(false)
  await act(async () => { save.click() }); await flush()
  expect(host.querySelector('[data-check-kind]')).toBeNull()

  // (e) Explicit clear.
  await checkLine(host, 'a1b2c3d4')
  const clear = buttonByText(card(host, 'a1b2c3d4'), '清除') as HTMLButtonElement
  await act(async () => { clear.click() }); await flush()
  expect(card(host, 'a1b2c3d4').querySelector('[data-check-kind]')).toBeNull()
  expect(checkButton(host).length).toBeGreaterThan(0)
  expect(fake.calls.some(call => call.path === 'line-check')).toBe(true)
})

test('test_line_check_ui_05 spec Scenario "没有缓存基准时不下结论"', async () => {
  const snapshot = ok({ kind: 'ok', latencyMs: 5, modelCount: 2, models: [{ id: 'a' }, { id: 'b' }], testedAt: '2026-10-30T03:00:00Z' })
  const cases: Record<string, unknown>[] = [
    { ...twoLines, groups: [], lastSyncAt: undefined },
    { ...twoLines, lastSyncAt: undefined },
    { ...twoLines, groups: [], lastSyncAt: '2026-10-25T10:00:00Z' },
  ]
  for (const view of cases) {
    const { host } = await mount(view, () => snapshot)
    await checkLine(host, 'a1b2c3d4')
    const line = card(host, 'a1b2c3d4').querySelector('[data-check-kind="ok"]')!
    expect(line.textContent).toContain('2 个模型')
    expect(line.textContent).toContain('5ms')
    expect(line.textContent).not.toContain('与缓存目录一致')
    expect(line.textContent).not.toContain('多 ')
    expect(line.textContent).not.toContain('少 ')
  }
})

test('test_line_check_ui_06 spec Scenario "检查线路后重新测速"', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  let latencyCalls = 0
  const fake = fakeApi({
    'GET settings': () => ok(settingsView(twoLines)),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => { latencyCalls++; return ok({ lines: [{ id: 'a1b2c3d4', ms: 80 }, { id: '9f0e7d6c', ms: 200 }] }) },
    'POST line-check': () => ok({ kind: 'ok', latencyMs: 42, modelCount: 3, models: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], testedAt: '2026-10-30T03:00:00Z' }),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
  mounted.push({ root, host })
  // Panel open measured once; a completed check on a saved line adds exactly one more pass.
  expect(latencyCalls).toBe(1)
  await checkLine(host, 'a1b2c3d4')
  expect(latencyCalls).toBe(2)
  expect(card(host, 'a1b2c3d4').querySelector('[data-latency-state="done"]')).not.toBeNull()
  expect(fake.calls.filter(call => call.method === 'POST' && call.path === 'settings')).toHaveLength(0)

  // An unsaved draft has no latency row, so checking it refreshes nothing.
  await act(async () => { buttonByText(host, '添加备用线路')!.click() }); await flush()
  const draft = Array.from(host.querySelectorAll('.dmg-line')).filter(node => !node.getAttribute('data-line-id')).pop() as HTMLElement
  act(() => inputValue(draft.querySelector('input:not([type=password])') as HTMLInputElement, 'http://draft.test:3425/v1'))
  act(() => inputValue(draft.querySelector('input[type=password]') as HTMLInputElement, 'K1'))
  await flush()
  const run = buttonByText(draft, '检查线路')
  await act(async () => { run!.click() }); await flush()
  expect(draft.querySelector('[data-check-kind="ok"]')).not.toBeNull()
  expect(latencyCalls).toBe(2)
})
